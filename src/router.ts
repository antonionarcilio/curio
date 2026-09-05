import express from 'express';
import deleteAudioRouter from './routes/audio/delete/route';
import downloadAudioRouter from './routes/audio/dl/route';
import streamAudioRouter from './routes/audio/stream/route';
import updateAudioRouter from './routes/audio/update/route';
import uploadAudioCancelRouter from './routes/audio/upload-cancel/route';
import uploadAudioPauseAllRouter from './routes/audio/upload-pause-all/route';
import uploadAudioPauseRouter from './routes/audio/upload-pause/route';
import uploadAudioProgressRouter from './routes/audio/upload-progress/route';
import uploadAudioResumeAllRouter from './routes/audio/upload-resume-all/route';
import uploadAudioResumeRouter from './routes/audio/upload-resume/route';
import uploadAudioRouter from './routes/audio/upload/route';
import listAudiosByRouter from './routes/audios/by/route';
import groupedAudiosRouter from './routes/audios/grouped/route';
import purgeCacheRouter from './routes/cache/purge/route';
import channelRouter from './routes/channel/route';
import channelsRouter from './routes/channels/route';
import healthRouter from './routes/health/route';
import meRouter from './routes/me/route';
import deleteVideoRouter from './routes/video/delete/route';
import downloadVideoRouter from './routes/video/dl/route';
import streamVideoRouter from './routes/video/stream/route';
import updateVideoRouter from './routes/video/update/route';
import uploadVideoCancelRouter from './routes/video/upload-cancel/route';
import uploadVideoPauseAllRouter from './routes/video/upload-pause-all/route';
import uploadVideoPauseRouter from './routes/video/upload-pause/route';
import uploadVideoProgressRouter from './routes/video/upload-progress/route';
import uploadVideoResumeAllRouter from './routes/video/upload-resume-all/route';
import uploadVideoResumeRouter from './routes/video/upload-resume/route';
import uploadVideoRouter from './routes/video/upload/route';
import listVideosByRouter from './routes/videos/by/route';
import groupedVideosRouter from './routes/videos/grouped/route';

const router = express.Router();

router.use(healthRouter);
router.use(meRouter);
router.use(channelRouter);
router.use(channelsRouter);
router.use(groupedVideosRouter);
router.use(listVideosByRouter);
router.use(groupedAudiosRouter);
router.use(listAudiosByRouter);
router.use(streamVideoRouter);
router.use(downloadVideoRouter);
router.use(streamAudioRouter);
router.use(downloadAudioRouter);
// As rotas "-all" (sem :jobId) precisam ser registradas antes de
// uploadVideoRouter/uploadAudioRouter: `/video/upload/pause` tem a mesma
// forma de `/video/upload/:chatId` (um segmento só), e o Express casa por
// ordem de registro — se uploadVideoRouter viesse primeiro, ele capturaria
// "pause" como chatId antes da rota em lote ser alcançada. O mesmo vale para
// o par de rotas de áudio.
router.use(uploadVideoPauseAllRouter);
router.use(uploadVideoResumeAllRouter);
router.use(uploadVideoRouter);
router.use(uploadVideoProgressRouter);
router.use(uploadVideoCancelRouter);
router.use(uploadVideoPauseRouter);
router.use(uploadVideoResumeRouter);
router.use(uploadAudioPauseAllRouter);
router.use(uploadAudioResumeAllRouter);
router.use(uploadAudioRouter);
router.use(uploadAudioProgressRouter);
router.use(uploadAudioCancelRouter);
router.use(uploadAudioPauseRouter);
router.use(uploadAudioResumeRouter);
router.use(updateVideoRouter);
router.use(deleteVideoRouter);
router.use(updateAudioRouter);
router.use(deleteAudioRouter);
router.use(purgeCacheRouter);

export = router;
