import express from 'express';
import purgeCacheRouter from './routes/cache/purge/route';
import channelsRouter from './routes/channels/route';
import deleteVideoRouter from './routes/video/delete/route';
import downloadVideoRouter from './routes/video/dl/route';
import streamVideoRouter from './routes/video/stream/route';
import updateVideoRouter from './routes/video/update/route';
import uploadVideoRouter from './routes/video/upload/route';
import listVideosByRouter from './routes/videos/by/route';
import groupedVideosRouter from './routes/videos/grouped/route';

const router = express.Router();

router.use(channelsRouter);
router.use(groupedVideosRouter);
router.use(listVideosByRouter);
router.use(streamVideoRouter);
router.use(downloadVideoRouter);
router.use(uploadVideoRouter);
router.use(updateVideoRouter);
router.use(deleteVideoRouter);
router.use(purgeCacheRouter);

export = router;
