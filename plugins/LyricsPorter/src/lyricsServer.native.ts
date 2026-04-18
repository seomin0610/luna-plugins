import * as http from "http";
import * as net from "net";
import * as dgram from "dgram";
import type { AddressInfo } from "net";

export type OutputMode = "http" | "tcp" | "udp";
export type LyricsMetadata = {
	title: string;
	artist: string;
	maxLyricLength: number;
	nextLyricLength: number;
};

let currentLyrics = "";
let activeMode: OutputMode | null = null;
let currentMetadata: LyricsMetadata = {
	title: "",
	artist: "",
	maxLyricLength: 0,
	nextLyricLength: 0,
};

// HTTP/SSE
let httpServer: http.Server | null = null;
let httpPort = 0;
const sseClients = new Set<http.ServerResponse>();

// TCP
let tcpServer: net.Server | null = null;
let tcpPort = 0;
const tcpClients = new Set<net.Socket>();

// UDP
let udpSocket: dgram.Socket | null = null;
let udpTargetHost = "127.0.0.1";
let udpTargetPort = 0;

// Metadata HTTP/SSE
let metadataHttpServer: http.Server | null = null;
let metadataHttpPort = 0;
const metadataSseClients = new Set<http.ServerResponse>();

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const send = (res: http.ServerResponse, status: number, body: string, contentType: string) => {
	res.writeHead(status, {
		...corsHeaders,
		"Content-Type": contentType,
		"Cache-Control": "no-store",
	});
	res.end(body);
};

const renderHtml = () => `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>LyricsPorter</title>
	<style>
		:root { color-scheme: dark; }
		html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; }
		body {
			display: flex;
			align-items: center;
			justify-content: center;
			font-family: "Segoe UI", "Apple SD Gothic Neo", sans-serif;
			color: #ffffff;
			text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
		}
		#lyric {
			font-size: clamp(24px, 6vw, 64px);
			text-align: center;
			padding: 2vh 4vw;
			line-height: 1.2;
			white-space: pre-wrap;
		}
	</style>
</head>
<body>
	<div id="lyric"></div>
	<script>
		const el = document.getElementById("lyric");
		const setText = (text) => { el.textContent = text || ""; };
		const fetchOnce = () => fetch("/lyrics", { cache: "no-store" })
			.then((res) => res.text())
			.then(setText)
			.catch(() => {});
		fetchOnce();
		if ("EventSource" in window) {
			const source = new EventSource("/events");
			source.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					setText(data.lyric);
				} catch {
					setText(event.data);
				}
			};
			source.onerror = () => {
				source.close();
				setInterval(fetchOnce, 1000);
			};
		} else {
			setInterval(fetchOnce, 1000);
		}
	</script>
</body>
</html>`;

const renderMetadataHtml = () => `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>LyricsPorter Metadata</title>
	<style>
		html, body { margin: 0; padding: 0; font-family: "Segoe UI", "Apple SD Gothic Neo", sans-serif; background: #0f0f0f; color: #f4f4f4; }
		main { max-width: 720px; margin: 32px auto; padding: 0 20px; }
		pre { background: #1a1a1a; border-radius: 8px; padding: 16px; overflow: auto; font-size: 14px; line-height: 1.45; }
		h1 { margin-top: 0; font-size: 20px; }
		p { color: #c7c7c7; }
	</style>
</head>
<body>
	<main>
		<h1>LyricsPorter Metadata</h1>
		<p>Current payload from <code>/metadata.json</code></p>
		<pre id="payload">{}</pre>
	</main>
	<script>
		const el = document.getElementById("payload");
		const setData = (payload) => {
			el.textContent = JSON.stringify(payload, null, 2);
		};
		const fetchOnce = () => fetch("/metadata.json", { cache: "no-store" })
			.then((res) => res.json())
			.then(setData)
			.catch(() => {});
		fetchOnce();
		if ("EventSource" in window) {
			const source = new EventSource("/events");
			source.onmessage = (event) => {
				try {
					setData(JSON.parse(event.data));
				} catch {}
			};
			source.onerror = () => {
				source.close();
				setInterval(fetchOnce, 1000);
			};
		} else {
			setInterval(fetchOnce, 1000);
		}
	</script>
</body>
</html>`;

const createMetadataPayload = () => ({
	title: currentMetadata.title ?? "",
	artist: currentMetadata.artist ?? "",
	maxLyricLength: Math.max(0, Math.trunc(currentMetadata.maxLyricLength ?? 0)),
	nextLyricLength: Math.max(0, Math.trunc(currentMetadata.nextLyricLength ?? 0)),
	ts: Date.now(),
});

const broadcastHttp = () => {
	if (sseClients.size === 0) return;
	const payload = JSON.stringify({ lyric: currentLyrics, ts: Date.now() });
	for (const res of sseClients) {
		res.write(`data: ${payload}\n\n`);
	}
};

const broadcastMetadataHttp = () => {
	if (metadataSseClients.size === 0) return;
	const payload = JSON.stringify(createMetadataPayload());
	for (const res of metadataSseClients) {
		res.write(`data: ${payload}\n\n`);
	}
};

const broadcastTcp = () => {
	if (tcpClients.size === 0) return;
	const payload = `${currentLyrics ?? ""}\n`;
	for (const socket of tcpClients) {
		if (socket.destroyed) {
			tcpClients.delete(socket);
			continue;
		}
		socket.write(payload);
	}
};

const sendUdp = () => {
	if (!udpSocket || !udpTargetPort) return;
	const payload = Buffer.from(currentLyrics ?? "", "utf8");
	udpSocket.send(payload, udpTargetPort, udpTargetHost, () => {});
};

export const setLyrics = (lyrics: string) => {
	currentLyrics = lyrics ?? "";
	if (activeMode === "http") broadcastHttp();
	else if (activeMode === "tcp") broadcastTcp();
	else if (activeMode === "udp") sendUdp();
};

export const setMetadata = (metadata: LyricsMetadata) => {
	currentMetadata = {
		title: metadata?.title ?? "",
		artist: metadata?.artist ?? "",
		maxLyricLength: Math.max(0, Math.trunc(metadata?.maxLyricLength ?? 0)),
		nextLyricLength: Math.max(0, Math.trunc(metadata?.nextLyricLength ?? 0)),
	};
	broadcastMetadataHttp();
};

const handleHttpRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
	if (req.method === "OPTIONS") {
		res.writeHead(204, corsHeaders);
		res.end();
		return;
	}

	const url = new URL(req.url ?? "/", "http://127.0.0.1");

	if (req.method !== "GET") {
		send(res, 405, "Method Not Allowed", "text/plain; charset=utf-8");
		return;
	}

	if (url.pathname === "/" || url.pathname === "/index.html") {
		send(res, 200, renderHtml(), "text/html; charset=utf-8");
		return;
	}

	if (url.pathname === "/lyrics") {
		send(res, 200, currentLyrics, "text/plain; charset=utf-8");
		return;
	}

	if (url.pathname === "/lyrics.json") {
		send(res, 200, JSON.stringify({ lyric: currentLyrics, ts: Date.now() }), "application/json; charset=utf-8");
		return;
	}

	if (url.pathname === "/events") {
		res.writeHead(200, {
			...corsHeaders,
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.write(`data: ${JSON.stringify({ lyric: currentLyrics, ts: Date.now() })}\n\n`);
		sseClients.add(res);
		req.on("close", () => sseClients.delete(res));
		return;
	}

	send(res, 404, "Not Found", "text/plain; charset=utf-8");
};

const handleMetadataHttpRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
	if (req.method === "OPTIONS") {
		res.writeHead(204, corsHeaders);
		res.end();
		return;
	}

	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	if (req.method !== "GET") {
		send(res, 405, "Method Not Allowed", "text/plain; charset=utf-8");
		return;
	}

	if (url.pathname === "/" || url.pathname === "/index.html") {
		send(res, 200, renderMetadataHtml(), "text/html; charset=utf-8");
		return;
	}

	if (url.pathname === "/metadata" || url.pathname === "/metadata.json") {
		send(res, 200, JSON.stringify(createMetadataPayload()), "application/json; charset=utf-8");
		return;
	}

	if (url.pathname === "/events") {
		res.writeHead(200, {
			...corsHeaders,
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.write(`data: ${JSON.stringify(createMetadataPayload())}\n\n`);
		metadataSseClients.add(res);
		req.on("close", () => metadataSseClients.delete(res));
		return;
	}

	send(res, 404, "Not Found", "text/plain; charset=utf-8");
};

const listenHttp = (targetPort: number) =>
	new Promise<number>((resolve, reject) => {
		if (!httpServer) return reject(new Error("HTTP server not initialized"));

		const onError = (err: Error) => {
			httpServer?.off("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			httpServer?.off("error", onError);
			const address = httpServer?.address() as AddressInfo | null;
			resolve(address?.port ?? targetPort);
		};

		httpServer.once("error", onError);
		httpServer.once("listening", onListening);
		httpServer.listen(targetPort, "127.0.0.1");
	});

const listenMetadataHttp = (targetPort: number) =>
	new Promise<number>((resolve, reject) => {
		if (!metadataHttpServer) return reject(new Error("Metadata HTTP server not initialized"));

		const onError = (err: Error) => {
			metadataHttpServer?.off("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			metadataHttpServer?.off("error", onError);
			const address = metadataHttpServer?.address() as AddressInfo | null;
			resolve(address?.port ?? targetPort);
		};

		metadataHttpServer.once("error", onError);
		metadataHttpServer.once("listening", onListening);
		metadataHttpServer.listen(targetPort, "127.0.0.1");
	});

const listenTcp = (targetPort: number) =>
	new Promise<number>((resolve, reject) => {
		if (!tcpServer) return reject(new Error("TCP server not initialized"));

		const onError = (err: Error) => {
			tcpServer?.off("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			tcpServer?.off("error", onError);
			const address = tcpServer?.address() as AddressInfo | null;
			resolve(address?.port ?? targetPort);
		};

		tcpServer.once("error", onError);
		tcpServer.once("listening", onListening);
		tcpServer.listen(targetPort, "127.0.0.1");
	});

const startHttp = async (port: number) => {
	if (httpServer && httpPort === port) return httpPort;
	await stopHttp();

	httpServer = http.createServer(handleHttpRequest);
	httpServer.on("clientError", (_err, socket) => {
		socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
	});

	try {
		const actualPort = await listenHttp(port);
		httpPort = actualPort;
		return actualPort;
	} catch (err) {
		const failing = httpServer;
		httpServer = null;
		httpPort = 0;
		if (failing) await new Promise<void>((resolve) => failing.close(() => resolve()));
		throw err;
	}
};

const startMetadataHttp = async (port: number) => {
	if (metadataHttpServer && metadataHttpPort === port) return metadataHttpPort;
	await stopMetadataServer();

	metadataHttpServer = http.createServer(handleMetadataHttpRequest);
	metadataHttpServer.on("clientError", (_err, socket) => {
		socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
	});

	try {
		const actualPort = await listenMetadataHttp(port);
		metadataHttpPort = actualPort;
		return actualPort;
	} catch (err) {
		const failing = metadataHttpServer;
		metadataHttpServer = null;
		metadataHttpPort = 0;
		if (failing) await new Promise<void>((resolve) => failing.close(() => resolve()));
		throw err;
	}
};

const startTcp = async (port: number) => {
	if (tcpServer && tcpPort === port) return tcpPort;
	await stopTcp();

	tcpServer = net.createServer((socket) => {
		socket.setNoDelay(true);
		tcpClients.add(socket);
		socket.on("close", () => tcpClients.delete(socket));
		socket.on("error", () => tcpClients.delete(socket));
		socket.write(`${currentLyrics ?? ""}\n`);
	});

	try {
		const actualPort = await listenTcp(port);
		tcpPort = actualPort;
		return actualPort;
	} catch (err) {
		const failing = tcpServer;
		tcpServer = null;
		tcpPort = 0;
		if (failing) await new Promise<void>((resolve) => failing.close(() => resolve()));
		throw err;
	}
};

const startUdp = async (port: number, host?: string) => {
	udpTargetHost = host?.trim() || "127.0.0.1";
	udpTargetPort = port;
	if (!udpSocket) {
		udpSocket = dgram.createSocket("udp4");
		udpSocket.on("error", () => {});
	}
	return port;
};

const stopHttp = async () => {
	if (!httpServer) return;
	const closing = httpServer;
	httpServer = null;
	httpPort = 0;
	for (const res of sseClients) res.end();
	sseClients.clear();
	await new Promise<void>((resolve) => closing.close(() => resolve()));
};

const stopTcp = async () => {
	if (!tcpServer) return;
	const closing = tcpServer;
	tcpServer = null;
	tcpPort = 0;
	for (const socket of tcpClients) socket.destroy();
	tcpClients.clear();
	await new Promise<void>((resolve) => closing.close(() => resolve()));
};

const stopUdp = async () => {
	if (!udpSocket) return;
	const closing = udpSocket;
	udpSocket = null;
	udpTargetPort = 0;
	await new Promise<void>((resolve) => closing.close(() => resolve()));
};

export const stopMetadataServer = async () => {
	if (!metadataHttpServer) return;
	const closing = metadataHttpServer;
	metadataHttpServer = null;
	metadataHttpPort = 0;
	for (const res of metadataSseClients) res.end();
	metadataSseClients.clear();
	await new Promise<void>((resolve) => closing.close(() => resolve()));
};

export const startServer = async (mode: OutputMode, port: number, udpHost?: string) => {
	if (activeMode !== mode) await stopServer();

	let actualPort = port;
	if (mode === "http") actualPort = await startHttp(port);
	else if (mode === "tcp") actualPort = await startTcp(port);
	else if (mode === "udp") actualPort = await startUdp(port, udpHost);

	activeMode = mode;
	return actualPort;
};

export const stopServer = async () => {
	activeMode = null;
	await Promise.all([stopHttp(), stopTcp(), stopUdp()]);
};

export const startMetadataServer = async (port: number) => startMetadataHttp(port);
