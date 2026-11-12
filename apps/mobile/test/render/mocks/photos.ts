// RENDER-TEST STAND-IN for src/lib/photos.ts (the real one opens the phone's photo picker and uploads). Records calls.
// window.__ownPhotos: what loadMyPhotos returns; window.__picked: what the picker returns; window.__uploadResult: override the upload outcome.
import { nextPositions } from '../../../src/core/photo-upload';
const g = globalThis as any;
const rec = (c: unknown) => { (g.__calls ??= []).push(c); };
export const pickPhotos = async (remaining: number) => { rec({ kind: 'pickPhotos', remaining }); if (g.__pickError) throw new Error(g.__pickError); return g.__picked ?? []; };
export const uploadPhotos = async (userId: string, uris: string[], visibleModes: string[], startPosition = 0) => {
  rec({ kind: 'uploadPhotos', uris, visibleModes, startPosition });
  if (g.__uploadResult) return g.__uploadResult;
  const list = (g.__ownPhotos ??= []);
  nextPositions([], uris.length).forEach((i) => list.push({ id: `new-${list.length}`, path: `p/${list.length}.jpg`, status: 'pending', visibleModes, position: startPosition + i, url: 'https://img.test/new.jpg' }));
  return { uploaded: uris.length, failed: 0, errors: [] };
};
export const loadMyPhotos = async () => JSON.parse(JSON.stringify(g.__ownPhotos ?? []));
export const makeMainPhoto = async (_photos: unknown, id: string) => { rec({ kind: 'makeMainPhoto', id }); };
