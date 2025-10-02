const fs = require('fs');
const path = require('path');

const TEMP_DB_PATH = path.join(__dirname, 'tmp-db.json');
process.env.BACKLOG_DB_FILE = TEMP_DB_PATH;

const request = require('supertest');
const app = require('../src/app');

const DEFAULT_DB_CONTENT = {
  projects: [],
  items: []
};

function resetDb() {
  fs.writeFileSync(TEMP_DB_PATH, JSON.stringify(DEFAULT_DB_CONTENT, null, 2));
}

beforeEach(() => {
  resetDb();
});

afterAll(() => {
  if (fs.existsSync(TEMP_DB_PATH)) {
    fs.unlinkSync(TEMP_DB_PATH);
  }
});

describe('Backlog Board API', () => {
  test('creates a project and hides the secret key in responses', async () => {
    const response = await request(app)
      .post('/api/projects')
      .send({ name: 'Test Project', secretKey: 'super-secret' });

    expect(response.status).toBe(201);
    expect(response.body.project).toMatchObject({ name: 'Test Project' });
    expect(response.body.project).not.toHaveProperty('secretKey');
    expect(response.body.project.id).toBeDefined();
  });

  test('denies duplicate secret keys', async () => {
    await request(app)
      .post('/api/projects')
      .send({ name: 'Project A', secretKey: 'dup-key' });

    const duplicate = await request(app)
      .post('/api/projects')
      .send({ name: 'Project B', secretKey: 'dup-key' });

    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error).toMatch(/Secret key already exists/);
  });

  test('allows accessing a project via secret key', async () => {
    const projectResponse = await request(app)
      .post('/api/projects')
      .send({ name: 'Secret Project', secretKey: 'abc123' });

    const accessResponse = await request(app)
      .post('/api/access')
      .send({ secretKey: 'abc123' });

    expect(accessResponse.status).toBe(200);
    expect(accessResponse.body.project).toMatchObject({ name: 'Secret Project' });
    expect(accessResponse.body.project.id).toBe(projectResponse.body.project.id);
  });

  test('performs CRUD on backlog items with secret validation', async () => {
    const projectRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Work Board', secretKey: 'letmein' });

    const projectId = projectRes.body.project.id;

    const createItemRes = await request(app)
      .post(`/api/projects/${projectId}/items`)
      .set('x-project-secret', 'letmein')
      .send({ title: 'First task', description: 'Do the thing' });

    expect(createItemRes.status).toBe(201);
    const itemId = createItemRes.body.item.id;

    const patchRes = await request(app)
      .patch(`/api/projects/${projectId}/items/${itemId}`)
      .set('x-project-secret', 'letmein')
      .send({ status: 'in_progress' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.item.status).toBe('in_progress');

    const deleteRes = await request(app)
      .delete(`/api/projects/${projectId}/items/${itemId}`)
      .set('x-project-secret', 'letmein');

    expect(deleteRes.status).toBe(204);
  });

  test('reorders items across columns', async () => {
    const projectRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Ordering Board', secretKey: 'order-me' });
    const projectId = projectRes.body.project.id;

    const secretHeader = { 'x-project-secret': 'order-me' };

    const firstItem = await request(app)
      .post(`/api/projects/${projectId}/items`)
      .set(secretHeader)
      .send({ title: 'Task 1' });

    const secondItem = await request(app)
      .post(`/api/projects/${projectId}/items`)
      .set(secretHeader)
      .send({ title: 'Task 2' });

    const reorderRes = await request(app)
      .post(`/api/projects/${projectId}/items/reorder`)
      .set(secretHeader)
      .send({
        columns: {
          backlog: [secondItem.body.item.id, firstItem.body.item.id],
          in_progress: [],
          review: [],
          done: []
        }
      });

    expect(reorderRes.status).toBe(200);
    const backlogItems = reorderRes.body.columns.backlog;
    expect(backlogItems.map((item) => item.id)).toEqual([
      secondItem.body.item.id,
      firstItem.body.item.id
    ]);
  });

  test('rejects invalid secrets on protected routes', async () => {
    const projectRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Secure Board', secretKey: 'right-key' });
    const projectId = projectRes.body.project.id;

    const response = await request(app)
      .get(`/api/projects/${projectId}`)
      .set('x-project-secret', 'wrong-key');

    expect(response.status).toBe(403);
  });
});
