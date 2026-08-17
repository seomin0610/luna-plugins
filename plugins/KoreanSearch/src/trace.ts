import { Tracer } from "@luna/core";

// index.ts <-> resolve.ts 순환 import를 피하려고 따로 뺐다
export const { trace } = Tracer("[KoreanSearch]");
