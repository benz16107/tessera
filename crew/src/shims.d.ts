declare module 'heic-convert' {
  export default function convert(o: { buffer: Buffer | ArrayBuffer; format: 'JPEG' | 'PNG'; quality?: number }): Promise<ArrayBuffer>;
}
