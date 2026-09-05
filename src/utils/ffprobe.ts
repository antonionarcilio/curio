import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type FfprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
};

export type FfprobeOutput = {
  format?: { duration?: string; tags?: Record<string, string> };
  streams?: FfprobeStream[];
};

// ffprobe precisa de acesso seekable ao arquivo (o moov atom de um MP4, ou os
// frames iniciais de um MP3 com tags ID3v2, podem exigir ler o arquivo
// inteiro), então recebe diretamente o arquivo temporário da requisição.
export async function runFfprobeJson(filePath: string): Promise<FfprobeOutput | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    return JSON.parse(stdout) as FfprobeOutput;
  } catch {
    // ffprobe ausente/falhou — chamador segue sem esses atributos explícitos.
    return null;
  }
}
