import express from 'express';
import purgeCacheRouter from './routes/cache/purge/route';
import channelRouter from './routes/channel/route';
import channelsRouter from './routes/channels/route';
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

router.use(channelRouter);
router.use(channelsRouter);
router.use(groupedVideosRouter);
router.use(listVideosByRouter);
router.use(streamVideoRouter);
router.use(downloadVideoRouter);
// As rotas "-all" (sem :jobId) precisam ser registradas antes de
// uploadVideoRouter: `/video/upload/pause` tem a mesma forma de
// `/video/upload/:chatId` (um segmento só), e o Express casa por ordem de
// registro — se uploadVideoRouter viesse primeiro, ele capturaria "pause"
// como chatId antes da rota em lote ser alcançada.
router.use(uploadVideoPauseAllRouter);
router.use(uploadVideoResumeAllRouter);
router.use(uploadVideoRouter);
router.use(uploadVideoProgressRouter);
router.use(uploadVideoCancelRouter);
router.use(uploadVideoPauseRouter);
router.use(uploadVideoResumeRouter);
router.use(updateVideoRouter);
router.use(deleteVideoRouter);
router.use(purgeCacheRouter);

export = router;
