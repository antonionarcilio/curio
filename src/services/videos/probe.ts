import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type ProbedVideoMetadata = { duration: number; width: number; height: number };

type FfprobeStream = { codec_type?: string; width?: number; height?: number; duration?: string };
type FfprobeOutput = { format?: { duration?: string }; streams?: FfprobeStream[] };

// A versão instalada de `telegram` nunca detecta metadados reais de vídeo —
// `_getMetadata` no pacote é um stub que sempre devolve um Map vazio (mesmo
// sem thumbnail), então todo upload sai com duration/width/height zerados a
// menos que a gente forneça um DocumentAttributeVideo explícito. `ffprobe`
// precisa de acesso seekable ao arquivo (o moov atom de um MP4 pode estar no
// fim), por isso os bytes são gravados num arquivo temporário em vez de
// passados por stdin.
export async function probeVideoMetadata(buffer: Buffer): Promise<ProbedVideoMetadata | null> {
  const tmpFilePath = path.join(os.tmpdir(), `telegram-cdn-upload-probe-${crypto.randomUUID()}.mp4`);

  try {
    await fs.writeFile(tmpFilePath, buffer);
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      tmpFilePath,
    ]);

    return parseFfprobeOutput(JSON.parse(stdout) as FfprobeOutput);
  } catch {
    // ffprobe ausente/falhou — upload segue sem esses atributos explícitos,
    // caindo de volta pro (incorreto, mas não fatal) default do TeleProto.
    return null;
  } finally {
    await fs.rm(tmpFilePath, { force: true });
  }
}

function parseFfprobeOutput(output: FfprobeOutput): ProbedVideoMetadata | null {
  const videoStream = output.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(output.format?.duration ?? videoStream?.duration ?? 0);
  const width = Number(videoStream?.width ?? 0);
  const height = Number(videoStream?.height ?? 0);

  if (!duration || !width || !height) return null;
  return { duration: Math.round(duration), width, height };
}
