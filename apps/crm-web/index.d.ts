/// <reference types="@nx/next/typings/style.d.ts" />
declare module '*.svg' {
  const content: string;
  export const ReactComponent: unknown;
  export default content;
}
