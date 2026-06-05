import { Router } from 'express';
import { FilesController } from './files.controller.js';
import { FilesService, LocalStorageDriver } from './files.service.js';
import { FilesRepository } from './files.repository.js';
import { db } from '../../config/db.js'; 
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';

export function createFilesRouter(dbInstance = db): Router {
  const router = Router();
  
  const repository = new FilesRepository(dbInstance);
  
  // Storage adapter points to a persistent data directory
  // In production, this would be an S3 bucket or mounted volume
  const storageAdapter = new LocalStorageDriver('./uploads');
  
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
