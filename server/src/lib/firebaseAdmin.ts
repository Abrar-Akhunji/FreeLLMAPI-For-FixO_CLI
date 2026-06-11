import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

class MockFirestore {
  public data: Record<string, any> = {};

  private getDocData(path: string) {
    return this.data[path] || null;
  }

  private setDocData(path: string, val: any) {
    this.data[path] = { ...val };
  }

  private deleteDocData(path: string) {
    delete this.data[path];
  }

  collection(name: string) {
    return new MockCollection(name, this);
  }

  batch() {
    return new MockBatch(this);
  }

  async runTransaction(cb: (t: any) => Promise<any>) {
    const t = {
      get: async (docRef: any) => docRef.get(),
      update: (docRef: any, data: any) => docRef.update(data)
    };
    return cb(t);
  }
}

class MockDocRef {
  constructor(public path: string, public db: MockFirestore, public id: string) {}

  async get() {
    const val = this.db['getDocData'](this.path);
    return {
      exists: val !== null,
      id: this.id,
      data: () => val
    };
  }

  async set(data: any, options?: any) {
    const current = this.db['getDocData'](this.path) || {};
    if (options?.merge) {
      this.db['setDocData'](this.path, { ...current, ...data });
    } else {
      this.db['setDocData'](this.path, data);
    }
  }

  async update(data: any) {
    const current = this.db['getDocData'](this.path) || {};
    this.db['setDocData'](this.path, { ...current, ...data });
  }

  async delete() {
    this.db['deleteDocData'](this.path);
  }

  collection(name: string) {
    return new MockCollection(`${this.path}/collections/${name}`, this.db);
  }
}

class MockCollection {
  constructor(public path: string, public db: MockFirestore) {}

  doc(id?: string) {
    const actualId = id || Math.random().toString(36).substring(7);
    return new MockDocRef(`${this.path}/docs/${actualId}`, this.db, actualId);
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this, (data: any) => {
      if (!data) return false;
      const v = data[field];
      if (op === '==') return v === val;
      if (op === '>=') return v >= val;
      if (op === '<') return v < val;
      return false;
    });
  }

  orderBy(field: string, direction?: string) {
    return new MockQuery(this, () => true, field, direction);
  }

  limit(n: number) {
    return new MockQuery(this, () => true, undefined, undefined, n);
  }

  async get() {
    return new MockQuery(this).get();
  }
}

class MockQuery {
  constructor(
    public coll: MockCollection,
    public filterFn: (data: any) => boolean = () => true,
    public sortField?: string,
    public sortDir?: string,
    public limitVal?: number
  ) {}

  where(field: string, op: string, val: any) {
    const oldFn = this.filterFn;
    return new MockQuery(this.coll, (data: any) => {
      if (!oldFn(data)) return false;
      const v = data[field];
      if (op === '==') return v === val;
      if (op === '>=') return v >= val;
      if (op === '<') return v < val;
      return false;
    }, this.sortField, this.sortDir, this.limitVal);
  }

  orderBy(field: string, direction?: string) {
    return new MockQuery(this.coll, this.filterFn, field, direction, this.limitVal);
  }

  limit(n: number) {
    return new MockQuery(this.coll, this.filterFn, this.sortField, this.sortDir, n);
  }

  async get() {
    const prefix = `${this.coll.path}/docs/`;
    let matchingRefs: MockDocRef[] = [];
    for (const k of Object.keys(this.coll.db.data)) {
      if (k.startsWith(prefix)) {
        const parts = k.slice(prefix.length).split('/');
        if (parts.length === 1) {
          const id = parts[0];
          matchingRefs.push(new MockDocRef(k, this.coll.db, id));
        }
      }
    }

    let docs = await Promise.all(
      matchingRefs.map(async (ref) => {
        const snap = await ref.get();
        return snap;
      })
    );

    docs = docs.filter(d => this.filterFn(d.data()));

    if (this.sortField) {
      docs.sort((a, b) => {
        const va = (a.data() as any)[this.sortField!];
        const vb = (b.data() as any)[this.sortField!];
        if (va < vb) return this.sortDir === 'desc' ? 1 : -1;
        if (va > vb) return this.sortDir === 'desc' ? -1 : 1;
        return 0;
      });
    }

    if (this.limitVal !== undefined) {
      docs = docs.slice(0, this.limitVal);
    }

    return {
      empty: docs.length === 0,
      docs
    };
  }
}

class MockBatch {
  private ops: Array<() => Promise<void>> = [];
  constructor(public db: MockFirestore) {}

  set(docRef: MockDocRef, data: any, options?: any) {
    this.ops.push(() => docRef.set(data, options));
    return this;
  }

  update(docRef: MockDocRef, data: any) {
    this.ops.push(() => docRef.update(data));
    return this;
  }

  async commit() {
    for (const op of this.ops) {
      await op();
    }
  }
}

const mockAdminAuth = {
  verifyIdToken: async (idToken: string) => {
    if (idToken === 'invalid-token') throw new Error('Invalid token');
    return {
      uid: 'test-user-uid',
      email: 'test@example.com',
      name: 'Test User',
      picture: 'https://example.com/pic.jpg',
    };
  }
};

import path from 'path';
import { fileURLToPath } from 'url';

const isTest = process.env.NODE_ENV === 'test';

// Important: do NOT throw at module-import time. This module is imported by
// the Vercel serverless entry point, and a thrown error here surfaces as an
// opaque FUNCTION_INVOCATION_FAILED instead of a clean JSON 500. Validate the
// service account if present (logging warnings on bad input), then let the
// first Firestore call fail naturally — initDb() catches it and re-throws a
// clear, actionable error that the request handler returns as JSON.
if (!isTest && getApps().length === 0) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  let initialized = false;

  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      const hasRequired =
        serviceAccount?.project_id &&
        serviceAccount?.private_key &&
        serviceAccount?.client_email;
      if (!hasRequired) {
        console.error(
          '[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT JSON is missing required ' +
            'fields (project_id, private_key, client_email). Re-download the ' +
            'service-account key from Firebase Console and paste the FULL JSON.'
        );
      } else {
        initializeApp({
          credential: cert(serviceAccount),
          projectId: serviceAccount.project_id,
        });
        initialized = true;
      }
    } catch (err: any) {
      console.error(
        '[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT is set but is not valid ' +
          'JSON. Paste the full contents of the .json file (including curly ' +
          'braces) as the env-var value. Parse error: ' + err.message
      );
    }
  } else {
    const googleCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (googleCreds && !path.isAbsolute(googleCreds)) {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const absoluteCredsPath = path.resolve(__dirname, '../../../', googleCreds);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = absoluteCredsPath;
    }
  }

  if (!initialized) {
    // Fallback init so getFirestore() below doesn't throw at top level.
    // Actual Firestore calls will fail with a credentials error that
    // initDb() catches and translates into a clear, JSON-friendly message.
    initializeApp({ projectId: 'fixo-builder' });
  }
}

export const adminAuth = isTest ? (mockAdminAuth as any) : getAuth();
export const firestore = isTest ? (new MockFirestore() as any) : getFirestore();
