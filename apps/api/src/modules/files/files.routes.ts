import { Router } from 'express';
import { FilesController } from './files.controller.js';
import { FilesService, createStorageAdapter } from './files.service.js';
import { FilesRepository } from './files.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';

export function createFilesRouter(dbInstance = db): Router {
  const router = Router();

  const repository = new FilesRepository(dbInstance);

  // Local disk in dev; STORAGE_DRIVER=s3 (+ STORAGE_S3_*) in production — Render's
  // disk is ephemeral, so anything uploaded to it dies on the next deploy.
  const storageAdapter = createStorageAdapter();
  
  const service = new FilesService(repository, storageAdapter);
  const controller = new FilesController(service);

  router.use(authenticate);

  router.post('/upload', authorize('files.create'), controller.uploadMiddleware, controller.uploadFile);
  router.get('/', authorize('files.read'), controller.listFiles);
  router.get('/:id', authorize('files.read'), controller.getFile);
  router.get('/:id/download', authorize('files.read'), controller.downloadFile);
  router.delete('/:id', authorize('files.delete'), controller.deleteFile);

  return router;
}
