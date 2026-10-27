import type { Project, ProjectSummary } from '@/types/project';
import { parseProject, projectSummary } from '@/data/projectSchema';

const DB_NAME = 'modulab';
const DB_VERSION = 1;
const PROJECT_STORE = 'projects';
const SETTINGS_STORE = 'settings';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador no soporta IndexedDB.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        const store = db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB.'));
  });
  return databasePromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Error de IndexedDB.'));
  });
}

export async function getAllLocalProjects(): Promise<Project[]> {
  const db = await openDatabase();
  const tx = db.transaction(PROJECT_STORE, 'readonly');
  const store = tx.objectStore(PROJECT_STORE);
  const records = await requestToPromise(store.getAll());
  return (records as unknown[])
    .map((record) => {
      try {
        return parseProject(record);
      } catch {
        return null;
      }
    })
    .filter((project): project is Project => Boolean(project));
}

export async function listLocalProjectSummaries(): Promise<ProjectSummary[]> {
  const projects = await getAllLocalProjects();
  return projects
    .map(projectSummary)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getLocalProject(id: string): Promise<Project | null> {
  const db = await openDatabase();
  const tx = db.transaction(PROJECT_STORE, 'readonly');
  const record = await requestToPromise(tx.objectStore(PROJECT_STORE).get(id));
  if (!record) return null;
  return parseProject(record);
}

export async function putLocalProject(project: Project): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(PROJECT_STORE, 'readwrite');
  await requestToPromise(tx.objectStore(PROJECT_STORE).put(structuredClone(project)));
}

export async function deleteLocalProject(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(PROJECT_STORE, 'readwrite');
  await requestToPromise(tx.objectStore(PROJECT_STORE).delete(id));
}

export async function getLocalSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const record = await requestToPromise(tx.objectStore(SETTINGS_STORE).get(key));
    if (!record || !('value' in record)) return fallback;
    return (record as { value: T }).value;
  } catch {
    try {
      const raw = localStorage.getItem(`modulab:${key}`);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }
}

export async function setLocalSetting<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    await requestToPromise(tx.objectStore(SETTINGS_STORE).put({ key, value }));
  } catch {
    try {
      localStorage.setItem(`modulab:${key}`, JSON.stringify(value));
    } catch {
      // Sin persistencia disponible.
    }
  }
}
