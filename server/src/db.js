const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

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

function listProjects() {
  const data = readData();
  return data.projects;
}

function getProjectById(projectId) {
  const data = readData();
  return data.projects.find((project) => project.id === projectId) || null;
}

function getProjectBySecret(secretKey) {
  const normalizedKey = (secretKey || '').trim();
  if (!normalizedKey) return null;
  const data = readData();
  return data.projects.find((project) => project.secretKey === normalizedKey) || null;
}

function createProject({ name, secretKey }) {
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

function deleteProject(projectId) {
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

function getItemsByProject(projectId) {
  const data = readData();
  return data.items
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => {
      if (a.status === b.status) {
        return (a.position ?? 0) - (b.position ?? 0);
      }
      return a.status.localeCompare(b.status);
    });
}

function nextPositionForStatus(data, projectId, status) {
  const items = data.items.filter((item) => item.projectId === projectId && item.status === status);
  if (items.length === 0) return 1;
  return Math.max(...items.map((item) => item.position ?? 0)) + 1;
}

const VALID_STATUSES = ['backlog', 'in_progress', 'review', 'done'];

function validateStatus(status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
}

function createItem(projectId, { title, description = '', status = 'backlog' }) {
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

function updateItem(projectId, itemId, updates) {
  const data = readData();
  const itemIndex = data.items.findIndex((item) => item.id === itemId && item.projectId === projectId);
  if (itemIndex === -1) {
    throw new Error('Item not found.');
  }

  const item = data.items[itemIndex];
  const updatedItem = { ...item };

  if (updates.title !== undefined) {
    const newTitle = updates.title.trim();
    if (!newTitle) {
      throw new Error('Item title cannot be empty.');
    }
    updatedItem.title = newTitle;
  }

  if (updates.description !== undefined) {
    updatedItem.description = updates.description.trim();
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

function deleteItem(projectId, itemId) {
  const data = readData();
  const itemIndex = data.items.findIndex((item) => item.id === itemId && item.projectId === projectId);
  if (itemIndex === -1) {
    throw new Error('Item not found.');
  }
  const [removed] = data.items.splice(itemIndex, 1);
  writeData(data);
  return removed;
}

function reorderItems(projectId, columns) {
  const data = readData();
  const projectExists = data.projects.some((project) => project.id === projectId);
  if (!projectExists) {
    throw new Error('Project not found.');
  }

  VALID_STATUSES.forEach((status) => {
    const orderedIds = columns[status] || [];
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
  return getItemsByProject(projectId);
}

module.exports = {
  VALID_STATUSES,
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
