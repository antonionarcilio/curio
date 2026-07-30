import { execFile } from 'child_process';
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
// fim), então recebe diretamente o arquivo temporário da requisição.
export async function probeVideoMetadata(videoPath: string): Promise<ProbedVideoMetadata | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ]);

    return parseFfprobeOutput(JSON.parse(stdout) as FfprobeOutput);
  } catch {
    // ffprobe ausente/falhou — upload segue sem esses atributos explícitos,
    // caindo de volta pro (incorreto, mas não fatal) default do TeleProto.
    return null;
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
