declare module "mammoth" {
  const mammoth: {
    extractRawText(input: { buffer: Uint8Array }): Promise<{ value: string }>;
  };
  export default mammoth;
}
