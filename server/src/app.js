const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const {
  VALID_STATUSES,
  createProject,
  deleteProject,
  getItemsByProject,
  getProjectById,
  getProjectBySecret,
  listProjects,
  createItem,
  updateItem,
  deleteItem,
  reorderItems
} = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

const CLIENT_BUILD_PATH = path.join(__dirname, '..', '..', 'client', 'dist');
const hasClientBuild = fs.existsSync(CLIENT_BUILD_PATH);

const sanitizeProject = (project) => {
  if (!project) return null;
  const { secretKey, ...rest } = project;
  return rest;
};

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/projects', (req, res) => {
  try {
    const { name, secretKey } = req.body;
    const project = createProject({ name, secretKey });
    res.status(201).json({ project: sanitizeProject(project) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/access', (req, res) => {
  const { secretKey } = req.body || {};
  const project = getProjectBySecret(secretKey);
  if (!project) {
    return res.status(404).json({ error: 'Invalid secret key.' });
  }
  res.json({ project: sanitizeProject(project) });
});

function requireProjectSecret(req, res, next) {
  const { projectId } = req.params;
  const providedSecret = `${req.headers['x-project-secret'] || ''}`.trim();

  const project = getProjectById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found.' });
  }

  if (project.secretKey !== providedSecret) {
    return res.status(403).json({ error: 'Invalid secret key for this project.' });
  }

  req.project = project;
  next();
}

app.get('/api/projects', (_req, res) => {
  const projects = listProjects().map(sanitizeProject);
  res.json({ projects });
});

app.get('/api/projects/:projectId', requireProjectSecret, (req, res) => {
  res.json({ project: sanitizeProject(req.project) });
});

app.delete('/api/projects/:projectId', requireProjectSecret, (req, res) => {
  const success = deleteProject(req.project.id);
  if (!success) {
    return res.status(404).json({ error: 'Project not found.' });
  }
  res.status(204).send();
});

function groupItemsByStatus(items) {
  const columns = VALID_STATUSES.reduce((acc, status) => {
    acc[status] = [];
    return acc;
  }, {});

  items.forEach((item) => {
    if (!columns[item.status]) {
      columns[item.status] = [];
    }
    columns[item.status].push(item);
  });

  return columns;
}

app.get('/api/projects/:projectId/items', requireProjectSecret, (req, res) => {
  const items = getItemsByProject(req.project.id);
  res.json({ columns: groupItemsByStatus(items) });
});

app.post('/api/projects/:projectId/items', requireProjectSecret, (req, res) => {
  try {
    const { title, description, status } = req.body;
    const item = createItem(req.project.id, { title, description, status });
    res.status(201).json({ item });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/projects/:projectId/items/:itemId', requireProjectSecret, (req, res) => {
  try {
    const { itemId } = req.params;
    const updated = updateItem(req.project.id, itemId, req.body || {});
    res.json({ item: updated });
  } catch (error) {
    if (error.message === 'Item not found.') {
      return res.status(404).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/projects/:projectId/items/:itemId', requireProjectSecret, (req, res) => {
  try {
    const { itemId } = req.params;
    deleteItem(req.project.id, itemId);
    res.status(204).send();
  } catch (error) {
    if (error.message === 'Item not found.') {
      return res.status(404).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/projects/:projectId/items/reorder', requireProjectSecret, (req, res) => {
  try {
    const columns = req.body?.columns || {};
    const items = reorderItems(req.project.id, columns);
    res.json({ columns: groupItemsByStatus(items) });
  } catch (error) {
    if (error.message === 'Project not found.') {
      return res.status(404).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
});

if (hasClientBuild) {
  app.use(express.static(CLIENT_BUILD_PATH));

  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_BUILD_PATH, 'index.html'));
  });
}

module.exports = app;
