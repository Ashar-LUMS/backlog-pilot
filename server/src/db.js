const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const VALID_STATUSES = ['backlog', 'in_progress', 'review', 'done'];

function validateStatus(status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
}

function toIsoString(value) {
  if (!value) return value;
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function sortItems(items) {
  const statusOrder = new Map(VALID_STATUSES.map((status, index) => [status, index]));
  return [...items].sort((a, b) => {
    const statusDiff = (statusOrder.get(a.status) ?? 0) - (statusOrder.get(b.status) ?? 0);
    if (statusDiff !== 0) {
      return statusDiff;
    }
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

const isPostgresEnabled = Boolean(process.env.DATABASE_URL);

if (isPostgresEnabled) {
  const { Pool } = require('pg');

  const connectionString = process.env.DATABASE_URL;
  const disableSsl =
    (process.env.PGSSLMODE || '').toLowerCase() === 'disable' ||
    (process.env.DATABASE_SSL || '').toLowerCase() === 'false';
  const isLocalAddress = /localhost|127\.0\.0\.1/i.test(connectionString || '');

  const poolConfig = { connectionString };
  if (!disableSsl && !isLocalAddress) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  const pool = new Pool(poolConfig);

  const initPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        secret_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (status = ANY(ARRAY['backlog', 'in_progress', 'review', 'done']))
      );
    `);

    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_items_project_status ON items(project_id, status);'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_items_project_position ON items(project_id, position);'
    );
  })().catch((error) => {
    console.error('Failed to initialize Postgres schema.', error);
    throw error;
  });

  async function ensureInit() {
    return initPromise;
  }

  function mapProject(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      secretKey: row.secret_key,
      createdAt: toIsoString(row.created_at)
    };
  }

  function mapItem(row) {
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description || '',
      status: row.status,
      position: row.position,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at)
    };
  }

  async function listProjects() {
    await ensureInit();
    const { rows } = await pool.query(
      'SELECT id, name, secret_key, created_at FROM projects ORDER BY created_at ASC, name ASC'
    );
    return rows.map(mapProject);
  }

  async function getProjectById(projectId) {
    await ensureInit();
    const { rows } = await pool.query(
      'SELECT id, name, secret_key, created_at FROM projects WHERE id = $1 LIMIT 1',
      [projectId]
    );
    return mapProject(rows[0]);
  }

  async function getProjectBySecret(secretKey) {
    await ensureInit();
    const normalizedKey = (secretKey || '').trim();
    if (!normalizedKey) return null;
    const { rows } = await pool.query(
      'SELECT id, name, secret_key, created_at FROM projects WHERE secret_key = $1 LIMIT 1',
      [normalizedKey]
    );
    return mapProject(rows[0]);
  }

  async function createProject({ name, secretKey }) {
    await ensureInit();

    const normalizedName = (name || '').trim();
    const normalizedKey = (secretKey || '').trim();

    if (!normalizedName) {
      throw new Error('Project name is required.');
    }
    if (!normalizedKey) {
      throw new Error('Secret key is required.');
    }

    try {
      const id = randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO projects (id, name, secret_key)
         VALUES ($1, $2, $3)
         RETURNING id, name, secret_key, created_at`,
        [id, normalizedName, normalizedKey]
      );

      return mapProject(rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        throw new Error('Secret key already exists. Choose a different one.');
      }
      throw error;
    }
  }

  async function deleteProject(projectId) {
    await ensureInit();
    const { rowCount } = await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    return rowCount > 0;
  }

  async function computeNextPosition(client, projectId, status) {
    const { rows } = await client.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM items WHERE project_id = $1 AND status = $2',
      [projectId, status]
    );
    return rows[0]?.next_position ?? 1;
  }

  async function getItemsByProject(projectId) {
    await ensureInit();
    const { rows } = await pool.query(
      'SELECT id, project_id, title, description, status, position, created_at, updated_at FROM items WHERE project_id = $1',
      [projectId]
    );
    return sortItems(rows.map(mapItem));
  }

  async function createItem(projectId, { title, description = '', status = 'backlog' }) {
    await ensureInit();

    const normalizedTitle = (title || '').trim();
    if (!normalizedTitle) {
      throw new Error('Item title is required.');
    }
    validateStatus(status);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const projectExists = await client.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
      if (projectExists.rowCount === 0) {
        throw new Error('Project not found.');
      }

      const position = await computeNextPosition(client, projectId, status);
      const id = randomUUID();
      const now = new Date();
      const trimmedDescription = (description || '').trim();

      const { rows } = await client.query(
        `INSERT INTO items (id, project_id, title, description, status, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id, project_id, title, description, status, position, created_at, updated_at`,
        [id, projectId, normalizedTitle, trimmedDescription, status, position, now]
      );

      await client.query('COMMIT');
      return mapItem(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateItem(projectId, itemId, updates = {}) {
    await ensureInit();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT id, project_id, title, description, status, position FROM items WHERE id = $1 AND project_id = $2',
        [itemId, projectId]
      );

      if (existing.rowCount === 0) {
        throw new Error('Item not found.');
      }

      const current = existing.rows[0];

      if (updates.title !== undefined) {
        const newTitle = `${updates.title}`.trim();
        if (!newTitle) {
          throw new Error('Item title cannot be empty.');
        }
        current.title = newTitle;
      }

      if (updates.description !== undefined) {
        current.description = `${updates.description}`.trim();
      }

      if (updates.status !== undefined) {
        validateStatus(updates.status);
        if (updates.status !== current.status) {
          current.status = updates.status;
          current.position = await computeNextPosition(client, projectId, current.status);
        }
      }

      const { rows } = await client.query(
        `UPDATE items
         SET title = $1,
             description = $2,
             status = $3,
             position = $4,
             updated_at = NOW()
         WHERE id = $5 AND project_id = $6
         RETURNING id, project_id, title, description, status, position, created_at, updated_at`,
        [current.title, current.description || '', current.status, current.position, itemId, projectId]
      );

      await client.query('COMMIT');
      return mapItem(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function deleteItem(projectId, itemId) {
    await ensureInit();
    const { rows } = await pool.query(
      'DELETE FROM items WHERE id = $1 AND project_id = $2 RETURNING id, project_id, title, description, status, position, created_at, updated_at',
      [itemId, projectId]
    );
    if (rows.length === 0) {
      throw new Error('Item not found.');
    }
    return mapItem(rows[0]);
  }

  async function reorderItems(projectId, columns = {}) {
    await ensureInit();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const projectExists = await client.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
      if (projectExists.rowCount === 0) {
        throw new Error('Project not found.');
      }

      for (const status of VALID_STATUSES) {
        const orderedIds = Array.isArray(columns[status]) ? columns[status] : [];
        for (let index = 0; index < orderedIds.length; index += 1) {
          const itemId = orderedIds[index];
          await client.query(
            `UPDATE items
             SET status = $1,
                 position = $2,
                 updated_at = NOW()
             WHERE id = $3 AND project_id = $4`,
            [status, index + 1, itemId, projectId]
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return getItemsByProject(projectId);
  }

  module.exports = {
    VALID_STATUSES,
    initDatabase: ensureInit,
    listProjects,
    getProjectById,
    getProjectBySecret,
    createProject,
    deleteProject,
    getItemsByProject,
    createItem,
    updateItem,
    deleteItem,
    reorderItems
  };
} else {
  const DATA_PATH = process.env.BACKLOG_DB_FILE
    ? path.resolve(process.env.BACKLOG_DB_FILE)
    : path.join(__dirname, '..', 'data', 'database.json');

  const DEFAULT_DATA = {
    projects: [],
    items: []
  };

  function ensureDatabase() {
    if (!fs.existsSync(DATA_PATH)) {
      const dir = path.dirname(DATA_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DATA_PATH, JSON.stringify(DEFAULT_DATA, null, 2));
    }
  }

  function readData() {
    ensureDatabase();
    const fileContent = fs.readFileSync(DATA_PATH, 'utf-8');
    try {
      return JSON.parse(fileContent);
    } catch (error) {
      console.error('Failed to parse database file; resetting.', error);
      fs.writeFileSync(DATA_PATH, JSON.stringify(DEFAULT_DATA, null, 2));
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  }

  function writeData(data) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  }

  function listProjectsSync() {
    const data = readData();
    return data.projects;
  }

  function getProjectByIdSync(projectId) {
    const data = readData();
    return data.projects.find((project) => project.id === projectId) || null;
  }

  function getProjectBySecretSync(secretKey) {
    const normalizedKey = (secretKey || '').trim();
    if (!normalizedKey) return null;
    const data = readData();
    return data.projects.find((project) => project.secretKey === normalizedKey) || null;
  }

  function createProjectSync({ name, secretKey }) {
    const normalizedName = (name || '').trim();
    const normalizedKey = (secretKey || '').trim();

    if (!normalizedName) {
      throw new Error('Project name is required.');
    }
    if (!normalizedKey) {
      throw new Error('Secret key is required.');
    }

    const data = readData();
    const existingKey = data.projects.find((project) => project.secretKey === normalizedKey);
    if (existingKey) {
      throw new Error('Secret key already exists. Choose a different one.');
    }

    const newProject = {
      id: randomUUID(),
      name: normalizedName,
      secretKey: normalizedKey,
      createdAt: new Date().toISOString()
    };

    data.projects.push(newProject);
    writeData(data);
    return newProject;
  }

  function deleteProjectSync(projectId) {
    const data = readData();
    const projectIndex = data.projects.findIndex((project) => project.id === projectId);
    if (projectIndex === -1) {
      return false;
    }

    data.projects.splice(projectIndex, 1);
    data.items = data.items.filter((item) => item.projectId !== projectId);
    writeData(data);
    return true;
  }

  function getItemsByProjectSync(projectId) {
    const data = readData();
    const items = data.items
      .filter((item) => item.projectId === projectId)
      .map((item) => ({
        ...item,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }));
    return sortItems(items);
  }

  function nextPositionForStatus(data, projectId, status) {
    const items = data.items.filter((item) => item.projectId === projectId && item.status === status);
    if (items.length === 0) return 1;
    return Math.max(...items.map((item) => item.position ?? 0)) + 1;
  }

  function createItemSync(projectId, { title, description = '', status = 'backlog' }) {
    const normalizedTitle = (title || '').trim();
    if (!normalizedTitle) {
      throw new Error('Item title is required.');
    }
    validateStatus(status);

    const data = readData();
    const project = data.projects.find((p) => p.id === projectId);
    if (!project) {
      throw new Error('Project not found.');
    }

    const newItem = {
      id: randomUUID(),
      projectId,
      title: normalizedTitle,
      description: (description || '').trim(),
      status,
      position: nextPositionForStatus(data, projectId, status),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    data.items.push(newItem);
    writeData(data);
    return newItem;
  }

  function updateItemSync(projectId, itemId, updates = {}) {
    const data = readData();
    const itemIndex = data.items.findIndex((item) => item.id === itemId && item.projectId === projectId);
    if (itemIndex === -1) {
      throw new Error('Item not found.');
    }

    const item = data.items[itemIndex];
    const updatedItem = { ...item };

    if (updates.title !== undefined) {
      const newTitle = `${updates.title}`.trim();
      if (!newTitle) {
        throw new Error('Item title cannot be empty.');
      }
      updatedItem.title = newTitle;
    }

    if (updates.description !== undefined) {
      updatedItem.description = `${updates.description}`.trim();
    }

    if (updates.status !== undefined) {
      validateStatus(updates.status);
      if (updates.status !== item.status) {
        updatedItem.status = updates.status;
        updatedItem.position = nextPositionForStatus(data, projectId, updates.status);
      }
    }

    updatedItem.updatedAt = new Date().toISOString();

    data.items[itemIndex] = updatedItem;
    writeData(data);
    return updatedItem;
  }

  function deleteItemSync(projectId, itemId) {
    const data = readData();
    const itemIndex = data.items.findIndex((item) => item.id === itemId && item.projectId === projectId);
    if (itemIndex === -1) {
      throw new Error('Item not found.');
    }
    const [removed] = data.items.splice(itemIndex, 1);
    writeData(data);
    return removed;
  }

  function reorderItemsSync(projectId, columns = {}) {
    const data = readData();
    const projectExists = data.projects.some((project) => project.id === projectId);
    if (!projectExists) {
      throw new Error('Project not found.');
    }

    VALID_STATUSES.forEach((status) => {
      const orderedIds = Array.isArray(columns[status]) ? columns[status] : [];
      orderedIds.forEach((itemId, index) => {
        const item = data.items.find((i) => i.id === itemId && i.projectId === projectId);
        if (item) {
          item.status = status;
          item.position = index + 1;
          item.updatedAt = new Date().toISOString();
        }
      });
    });

    writeData(data);
    return getItemsByProjectSync(projectId);
  }

  module.exports = {
    VALID_STATUSES,
    initDatabase: async () => {
      ensureDatabase();
    },
    listProjects: async () => listProjectsSync(),
    getProjectById: async (projectId) => getProjectByIdSync(projectId),
    getProjectBySecret: async (secretKey) => getProjectBySecretSync(secretKey),
    createProject: async (input) => createProjectSync(input),
    deleteProject: async (projectId) => deleteProjectSync(projectId),
    getItemsByProject: async (projectId) => getItemsByProjectSync(projectId),
    createItem: async (projectId, payload) => createItemSync(projectId, payload),
    updateItem: async (projectId, itemId, updates) => updateItemSync(projectId, itemId, updates),
    deleteItem: async (projectId, itemId) => deleteItemSync(projectId, itemId),
    reorderItems: async (projectId, columns) => reorderItemsSync(projectId, columns)
  };
}
