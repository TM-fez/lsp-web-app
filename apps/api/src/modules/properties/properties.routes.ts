import { Router } from 'express';
import { PropertiesController } from './properties.controller.js';
import { PropertiesService } from './properties.service.js';
import { PropertiesRepository } from './properties.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';

export function createPropertiesRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new PropertiesRepository(dbInstance);
  const service = new PropertiesService(repository);
  const controller = new PropertiesController(service);

  router.use(authenticate);

  router.get('/', authorize('properties.read'), controller.list);
  router.post('/', authorize('properties.create'), controller.createProperty);

  // Building update is registered before '/:id' so the extra path segment wins cleanly.
  router.patch('/buildings/:buildingId', authorize('buildings.update'), controller.updateBuilding);

  router.patch('/:id', authorize('properties.update'), controller.updateProperty);
  router.post('/:id/buildings', authorize('buildings.create'), controller.createBuilding);

  return router;
}
