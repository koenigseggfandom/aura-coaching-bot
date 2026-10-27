import { MongoClient, ObjectId } from 'mongodb';
import { logger } from '../utils/logger.js';

/**
 * Normalizes document ID for MongoDB queries.
 * Matches string IDs or ObjectId if valid 24-char hex string.
 */
function buildIdFilter(id) {
    const idStr = String(id);
    if (/^[0-9a-fA-F]{24}$/.test(idStr)) {
        try {
            return { $or: [{ _id: idStr }, { _id: new ObjectId(idStr) }] };
        } catch (_) {
            return { _id: idStr };
        }
    }
    return { _id: idStr };
}

/**
 * Formats a raw MongoDB document into a Firestore-like document snapshot.
 */
function formatDocSnapshot(rawDoc) {
    if (!rawDoc) {
        return {
            exists: false,
            id: null,
            data: () => null
        };
    }

    const { _id, ...rest } = rawDoc;
    const docId = String(_id);

    return {
        exists: true,
        id: docId,
        data: () => ({ id: docId, ...rest })
    };
}

/**
 * Query builder that mimics Firestore's Query interface
 */
class MongoQueryBuilder {
    constructor(collection, filters = {}, sortObj = {}, limitCount = 0) {
        this.collection = collection;
        this.filters = { ...filters };
        this.sortObj = { ...sortObj };
        this.limitCount = limitCount;
    }

    where(field, op, value) {
        const nextFilters = { ...this.filters };
        if (op === '==' || op === '===') {
            nextFilters[field] = value;
        } else if (op === '!=') {
            nextFilters[field] = { $ne: value };
        } else if (op === '>') {
            nextFilters[field] = { ...(nextFilters[field] || {}), $gt: value };
        } else if (op === '>=') {
            nextFilters[field] = { ...(nextFilters[field] || {}), $gte: value };
        } else if (op === '<') {
            nextFilters[field] = { ...(nextFilters[field] || {}), $lt: value };
        } else if (op === '<=') {
            nextFilters[field] = { ...(nextFilters[field] || {}), $lte: value };
        } else if (op === 'in') {
            nextFilters[field] = { $in: value };
        } else if (op === 'array-contains') {
            nextFilters[field] = value;
        } else {
            nextFilters[field] = value;
        }
        return new MongoQueryBuilder(this.collection, nextFilters, this.sortObj, this.limitCount);
    }

    orderBy(field, direction = 'asc') {
        const nextSort = { ...this.sortObj, [field]: direction.toLowerCase() === 'desc' ? -1 : 1 };
        return new MongoQueryBuilder(this.collection, this.filters, nextSort, this.limitCount);
    }

    limit(n) {
        return new MongoQueryBuilder(this.collection, this.filters, this.sortObj, n);
    }

    async get() {
        let cursor = this.collection.find(this.filters);
        if (Object.keys(this.sortObj).length > 0) {
            cursor = cursor.sort(this.sortObj);
        }
        if (this.limitCount > 0) {
            cursor = cursor.limit(this.limitCount);
        }
        const docs = await cursor.toArray();
        const docSnapshots = docs.map(formatDocSnapshot);

        return {
            empty: docSnapshots.length === 0,
            size: docSnapshots.length,
            docs: docSnapshots,
            forEach: (cb) => docSnapshots.forEach(cb)
        };
    }
}

/**
 * Document reference that mimics Firestore's DocumentReference interface
 */
class MongoDocRef {
    constructor(collection, docId) {
        this.collection = collection;
        this.id = String(docId);
    }

    async get() {
        const filter = buildIdFilter(this.id);
        const doc = await this.collection.findOne(filter);
        return formatDocSnapshot(doc);
    }

    async set(data, options = {}) {
        const filter = buildIdFilter(this.id);
        const payload = { ...data };
        delete payload._id;

        if (options && options.merge) {
            await this.collection.updateOne(
                filter,
                { $set: payload },
                { upsert: true }
            );
        } else {
            await this.collection.replaceOne(
                filter,
                { _id: this.id, ...payload },
                { upsert: true }
            );
        }
        return this;
    }

    async update(data) {
        const filter = buildIdFilter(this.id);
        const payload = { ...data };
        delete payload._id;

        await this.collection.updateOne(filter, { $set: payload });
        return this;
    }

    async delete() {
        const filter = buildIdFilter(this.id);
        await this.collection.deleteOne(filter);
        return this;
    }

    onSnapshot(onNext, onError) {
        let lastHash = '';
        let active = true;

        const poll = async () => {
            if (!active) return;
            try {
                const doc = await this.get();
                const json = JSON.stringify(doc.data() || {});
                if (json !== lastHash) {
                    lastHash = json;
                    onNext(doc);
                }
            } catch (err) {
                if (onError) onError(err);
            }
        };

        poll();
        const intervalId = setInterval(poll, 2500);

        return () => {
            active = false;
            clearInterval(intervalId);
        };
    }
}

/**
 * Collection reference that mimics Firestore's CollectionReference interface
 */
class MongoCollectionRef extends MongoQueryBuilder {
    constructor(collection, name) {
        super(collection, {}, {}, 0);
        this.name = name;
    }

    doc(id) {
        return new MongoDocRef(this.collection, id);
    }

    async add(data) {
        const newId = new ObjectId().toHexString();
        const docData = { _id: newId, ...data };
        await this.collection.insertOne(docData);
        return new MongoDocRef(this.collection, newId);
    }

    onSnapshot(onNext, onError) {
        let knownDocs = new Map();
        let isFirstRun = true;
        let active = true;

        const poll = async () => {
            if (!active) return;
            try {
                const rawDocs = await this.collection.find(this.filters).toArray();
                const currentDocsMap = new Map();
                const docChanges = [];

                for (const raw of rawDocs) {
                    const snap = formatDocSnapshot(raw);
                    const hash = JSON.stringify(snap.data());
                    currentDocsMap.set(snap.id, { snap, hash });

                    if (!knownDocs.has(snap.id)) {
                        docChanges.push({ type: 'added', doc: snap });
                    } else if (knownDocs.get(snap.id).hash !== hash) {
                        docChanges.push({ type: 'modified', doc: snap });
                    }
                }

                for (const [id, val] of knownDocs.entries()) {
                    if (!currentDocsMap.has(id)) {
                        docChanges.push({ type: 'removed', doc: val.snap });
                    }
                }

                knownDocs = currentDocsMap;

                if (isFirstRun || docChanges.length > 0) {
                    isFirstRun = false;
                    const allDocs = Array.from(knownDocs.values()).map((v) => v.snap);
                    const snapshot = {
                        empty: allDocs.length === 0,
                        size: allDocs.length,
                        docs: allDocs,
                        forEach: (cb) => allDocs.forEach(cb),
                        docChanges: () => docChanges
                    };
                    onNext(snapshot);
                }
            } catch (err) {
                if (onError) onError(err);
            }
        };

        poll();
        const intervalId = setInterval(poll, 2500);

        return () => {
            active = false;
            clearInterval(intervalId);
        };
    }
}

/**
 * Creates the Firestore-compatible adapter over MongoDB
 */
export function createMongoFirestoreAdapter(mongoDb) {
    return {
        collection: (name) => {
            const rawCol = mongoDb.collection(name);
            return new MongoCollectionRef(rawCol, name);
        }
    };
}
