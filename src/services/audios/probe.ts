import { runFfprobeJson, type FfprobeOutput } from '@/utils/ffprobe';

export type ProbedAudioMetadata = { duration: number; title: string | null; performer: string | null };

// Ao contrário do vídeo, duração é a única exigência: title/performer são
// opcionais de forma independente (nem todo arquivo de áudio carrega tags
// ID3, e isso não deve impedir o upload de acontecer).
export async function probeAudioMetadata(audioPath: string): Promise<ProbedAudioMetadata | null> {
  const output = await runFfprobeJson(audioPath);
  if (!output) return null;
  return parseFfprobeAudioOutput(output);
}

// Tags ID3 aparecem com grafia inconsistente entre encoders (title/TITLE,
// artist/ARTIST/performer/PERFORMER) — procura por qualquer alias conhecido
// em vez de assumir uma chave canônica.
function findTag(tags: Record<string, string> | undefined, aliases: string[]): string | null {
  if (!tags) return null;
  const lowerCasedTags = Object.fromEntries(Object.entries(tags).map(([key, value]) => [key.toLowerCase(), value]));
  for (const alias of aliases) {
    const value = lowerCasedTags[alias];
    if (value) return value;
  }
  return null;
}

function parseFfprobeAudioOutput(output: FfprobeOutput): ProbedAudioMetadata | null {
  const audioStream = output.streams?.find((stream) => stream.codec_type === 'audio');
  const duration = Number(output.format?.duration ?? audioStream?.duration ?? 0);
  if (!duration) return null;

  return {
    duration: Math.round(duration),
    title: findTag(output.format?.tags, ['title']),
    performer: findTag(output.format?.tags, ['artist', 'performer']),
  };
}
