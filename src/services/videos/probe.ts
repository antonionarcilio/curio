import { runFfprobeJson, type FfprobeOutput } from '@/utils/ffprobe';

export type ProbedVideoMetadata = { duration: number; width: number; height: number };

// A versão instalada de `telegram` nunca detecta metadados reais de vídeo —
// `_getMetadata` no pacote é um stub que sempre devolve um Map vazio (mesmo
// sem thumbnail), então todo upload sai com duration/width/height zerados a
// menos que a gente forneça um DocumentAttributeVideo explícito.
export async function probeVideoMetadata(videoPath: string): Promise<ProbedVideoMetadata | null> {
  const output = await runFfprobeJson(videoPath);
  if (!output) return null;
  return parseFfprobeVideoOutput(output);
}

function parseFfprobeVideoOutput(output: FfprobeOutput): ProbedVideoMetadata | null {
  const videoStream = output.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(output.format?.duration ?? videoStream?.duration ?? 0);
  const width = Number(videoStream?.width ?? 0);
  const height = Number(videoStream?.height ?? 0);

  if (!duration || !width || !height) return null;
  return { duration: Math.round(duration), width, height };
}
