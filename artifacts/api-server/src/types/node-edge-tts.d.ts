/** Minimal typing — package ships without declarations (see src/lib/tts.ts usage). */
declare module "node-edge-tts" {
  export class EdgeTTS {
    constructor(opts: {
      voice: string;
      lang: string;
      outputFormat: string;
      saveSubtitles: boolean;
      timeout: number;
    });
    ttsPromise(text: string, outPath: string): Promise<void>;
  }
}
