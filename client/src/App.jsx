import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { api } from './api';
import { COLUMN_ORDER, COLUMN_LABELS } from './constants';
import './App.css';

const STORAGE_KEY = 'backlog-board-session';

const createEmptyColumns = () =>
  COLUMN_ORDER.reduce((acc, status) => {
    acc[status] = [];
    return acc;
  }, {});

const ensureColumns = (incoming) => {
  const base = createEmptyColumns();
  if (!incoming) return base;
  COLUMN_ORDER.forEach((status) => {
    if (Array.isArray(incoming[status])) {
      base[status] = incoming[status].map((item) => ({ ...item }));
    }
  });
  return base;
};

const cloneColumns = (columns) => {
  const cloned = {};
  COLUMN_ORDER.forEach((status) => {
    cloned[status] = (columns[status] || []).map((item) => ({ ...item }));
  });
  return cloned;
};

const columnsToIds = (columns) =>
  COLUMN_ORDER.reduce((acc, status) => {
    acc[status] = (columns[status] || []).map((item) => item.id);
    return acc;
  }, {});

function ShareLink({ projectId, variant = 'secondary' }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(null);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('project', projectId);
    return url.toString();
  }, [projectId]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else if (typeof window !== 'undefined') {
        window.prompt('Copy invite link', shareUrl);
      }
      setCopied(true);
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy invite link', error);
    }
  }, [shareUrl]);

  useEffect(() => () => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }
  }, []);

  return (
    <button
      type="button"
      className={`share-button ${variant} ${copied ? 'is-copied' : ''}`.trim()}
      onClick={handleCopy}
      disabled={!shareUrl}
      title={shareUrl}
    >
      {copied ? 'Link copied!' : 'Copy invite link'}
    </button>
  );
}

function TaskDrawer({
  open,
  item,
  busy,
  onClose,
  onSave,
  onDelete
}) {
  const [title, setTitle] = useState(item?.title || '');
  const [description, setDescription] = useState(item?.description || '');
  const [error, setError] = useState('');
  const firstFieldRef = useRef(null);

  useEffect(() => {
    setTitle(item?.title || '');
    setDescription(item?.description || '');
    setError('');
  }, [item?.id]);

  useEffect(() => {
    if (open) {
      // Focus first field when opening
      const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setError('Title cannot be empty.');
      return;
    }
    try {
      await onSave(item.id, { title: t, description: description.trim() });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!open || !item) return null;

  return (
    <div className="drawer-overlay" onClick={onClose} aria-hidden={!open}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="drawer-header">
          <h3 id="drawer-title">Edit item</h3>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <form className="form drawer-form" onSubmit={handleSave}>
          <label htmlFor="drawer-title-input">Title</label>
          <input
            id="drawer-title-input"
            ref={firstFieldRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
          <label htmlFor="drawer-desc-input">Description</label>
          <textarea
            id="drawer-desc-input"
            rows="6"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
          <div className="drawer-meta">
            <span>Created {item?.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</span>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => onDelete(item.id)}
              disabled={busy}
              title="Delete item"
            >
              Delete
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function ProjectBadge({ name }) {
  const initials = useMemo(() => {
    const trimmed = (name || '').trim();
    if (!trimmed) return 'BP';
    const parts = trimmed.split(/\s+/).slice(0, 2);
    const letters = parts
      .map((part) => part.charAt(0)?.toUpperCase() || '')
      .join('');
    return letters || 'BP';
  }, [name]);

  return (
    <span className="project-badge" aria-hidden="true">
      {initials}
    </span>
  );
}

function LandingView({ onAccess, onCreate, busy, inviteProjectId, onClearInvite }) {
  const [accessSecret, setAccessSecret] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newSecretKey, setNewSecretKey] = useState('');
  const [errors, setErrors] = useState({ access: '', create: '' });

  const handleAccess = async (event) => {
    event.preventDefault();
    const secret = accessSecret.trim();
    if (!secret) {
      setErrors((prev) => ({ ...prev, access: 'Enter the project secret to continue.' }));
      return;
    }
    setErrors((prev) => ({ ...prev, access: '' }));
    try {
      await onAccess(secret, inviteProjectId);
      setAccessSecret('');
    } catch (error) {
      setErrors((prev) => ({ ...prev, access: error.message }));
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    const name = newProjectName.trim();
    const secret = newSecretKey.trim();
    if (!name || !secret) {
      setErrors((prev) => ({
        ...prev,
        create: 'Enter both a project name and secret key.'
      }));
      return;
    }
    setErrors((prev) => ({ ...prev, create: '' }));
    try {
      await onCreate({ name, secretKey: secret });
      setNewProjectName('');
      setNewSecretKey('');
    } catch (error) {
      setErrors((prev) => ({ ...prev, create: error.message }));
    }
  };

  return (
    <div className="landing">
      <section className="panel panel-primary">
        <h2>Return to your team space</h2>
        <p>Drop in your shared secret to reopen the board exactly where you left it.</p>
        {inviteProjectId ? (
          <div className="invite-hint">
            <p>
              Invite link detected. Enter the secret for project ID{' '}
              <code>{inviteProjectId}</code> to open the board.
            </p>
            {onClearInvite ? (
              <button type="button" className="ghost" onClick={onClearInvite} disabled={busy}>
                Use a different project
              </button>
            ) : null}
          </div>
        ) : null}
        <form className="form" onSubmit={handleAccess}>
          <label htmlFor="access-secret">Secret key</label>
          <input
            id="access-secret"
            type="password"
            value={accessSecret}
            onChange={(event) => setAccessSecret(event.target.value)}
            disabled={busy}
            placeholder="e.g. sprint-rocket-2025"
          />
          {errors.access && <p className="form-error">{errors.access}</p>}
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Loading…' : 'Open backlog'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Spin up a new project</h2>
        <p>
          Name the initiative, choose a memorable secret, and start shaping the work in
          seconds.
        </p>
        <form className="form" onSubmit={handleCreate}>
          <label htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            type="text"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            disabled={busy}
            placeholder="e.g. Mars Rover"
          />

          <label htmlFor="project-secret">Secret key</label>
          <input
            id="project-secret"
            type="password"
            value={newSecretKey}
            onChange={(event) => setNewSecretKey(event.target.value)}
            disabled={busy}
            placeholder="Provide a unique passphrase"
          />
          {errors.create && <p className="form-error">{errors.create}</p>}
          <button type="submit" className="secondary" disabled={busy}>
            {busy ? 'Saving…' : 'Create project'}
          </button>
        </form>
      </section>
    </div>
  );
}

function AddCardForm({ status, onAdd, busy }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setError('');
    }
  }, [open]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Add a title to create the backlog item.');
      return;
    }
    try {
      await onAdd(status, { title: trimmedTitle, description: description.trim() });
      setOpen(false);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="ghost"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        + Add item
      </button>
    );
  }

  return (
    <form className="form card-form" onSubmit={handleSubmit}>
      <input
        type="text"
        value={title}
        placeholder="Item title"
        onChange={(event) => setTitle(event.target.value)}
        disabled={busy}
      />
      <textarea
        rows="3"
        value={description}
        placeholder="Optional description"
        onChange={(event) => setDescription(event.target.value)}
        disabled={busy}
      />
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add item'}
        </button>
        <button type="button" className="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function BoardCard({ item, busy, onOpen, onDelete }) {
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (busy) return;
    try {
      await onDelete(item.id);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="card-content">
      <div className="card-header">
        <h4>{item.title}</h4>
        <div className="card-icon-buttons">
          <button
            type="button"
            className="card-icon-button"
            onClick={(e) => { e.stopPropagation(); onOpen(item); }}
            disabled={busy}
            aria-label="Edit backlog item"
            title="Edit backlog item"
          >
            ✎
          </button>
          <button
            type="button"
            className="card-icon-button danger"
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            disabled={busy}
            aria-label="Delete backlog item"
            title="Delete backlog item"
          >
            🗑
          </button>
        </div>
      </div>
      {item.description && <p>{item.description}</p>}
      <div className="card-meta">
        <span>{new Date(item.createdAt).toLocaleDateString()}</span>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function App() {
  const [project, setProject] = useState(null);
  const [secretKey, setSecretKey] = useState('');
  const [columns, setColumns] = useState(createEmptyColumns);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [inviteProjectId, setInviteProjectId] = useState(null);
  const [density, setDensity] = useState(() => {
    if (typeof window === 'undefined') return 'comfortable';
    return localStorage.getItem('ui-density') || 'comfortable';
  });
  const [drawerItem, setDrawerItem] = useState(null);

  const activeColumns = useMemo(() => ensureColumns(columns), [columns]);

  const statusMetrics = useMemo(
    () =>
      COLUMN_ORDER.map((status) => ({
        status,
        label: COLUMN_LABELS[status],
        count: activeColumns[status].length
      })),
    [activeColumns]
  );

  useEffect(() => {
    if (!info) return undefined;
    const timer = setTimeout(() => setInfo(''), 5000);
    return () => clearTimeout(timer);
  }, [info]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const paramId = params.get('project');
    if (paramId) {
      setInviteProjectId(paramId);
    }
  }, []);

  const fetchBoard = useCallback(async (projectId, key) => {
    const [projectRes, columnsRes] = await Promise.all([
      api.fetchProject(projectId, key),
      api.fetchColumns(projectId, key)
    ]);
    return { project: projectRes.project, columns: columnsRes.columns };
  }, []);

  const applyBoard = useCallback((board, key, { persist } = { persist: true }) => {
    setProject(board.project);
    setSecretKey(key);
    setColumns(ensureColumns(board.columns));
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('project', board.project.id);
      window.history.replaceState(null, '', url.toString());
    }
    setInviteProjectId(board.project.id);
    if (persist) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ projectId: board.project.id, secretKey: key })
      );
    }
  }, []);

  const handleClearInvite = useCallback(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('project');
      window.history.replaceState(null, '', url.toString());
    }
    setInviteProjectId(null);
  }, []);

  const clearBoard = useCallback(() => {
    setProject(null);
    setSecretKey('');
    setColumns(createEmptyColumns());
    localStorage.removeItem(STORAGE_KEY);
    handleClearInvite();
  }, [handleClearInvite]);

  const handleAccess = useCallback(
    async (secret, projectHint) => {
      setBusy(true);
      setError('');
      setInfo('');
      try {
        let board;
        if (projectHint) {
          board = await fetchBoard(projectHint, secret);
        } else {
          const { project: accessedProject } = await api.accessProject(secret);
          board = await fetchBoard(accessedProject.id, secret);
        }
        applyBoard(board, secret, { persist: true });
        setInfo(`Loaded project “${board.project.name}”.`);
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [applyBoard, fetchBoard]
  );

  const handleCreateProject = useCallback(
    async ({ name, secretKey: secret }) => {
      setBusy(true);
      setError('');
      setInfo('');
      try {
        const { project: created } = await api.createProject({ name, secretKey: secret });
        applyBoard({ project: created, columns: createEmptyColumns() }, secret, {
          persist: true
        });
        setInfo(`Created project “${created.name}”. Share the secret to collaborate.`);
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [applyBoard]
  );

  const refreshBoard = useCallback(async () => {
    if (!project || !secretKey) return;
    setBusy(true);
    setError('');
    try {
      const board = await fetchBoard(project.id, secretKey);
      applyBoard(board, secretKey, { persist: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [applyBoard, fetchBoard, project, secretKey]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.projectId && parsed?.secretKey) {
        setBusy(true);
        fetchBoard(parsed.projectId, parsed.secretKey)
          .then((board) => {
            applyBoard(board, parsed.secretKey, { persist: true });
            setInfo(`Welcome back to “${board.project.name}”.`);
          })
          .catch((err) => {
            console.error(err);
            setError(err.message);
            clearBoard();
          })
          .finally(() => {
            setBusy(false);
          });
      }
    } catch (err) {
      console.error('Failed to restore project session', err);
      clearBoard();
    }
  }, [applyBoard, clearBoard, fetchBoard]);

  const handleAddItem = useCallback(
    async (status, item) => {
      if (!project || !secretKey) return;
      setError('');
      const previous = cloneColumns(activeColumns);
      try {
        setBusy(true);
        const { item: created } = await api.createItem(project.id, secretKey, {
          ...item,
          status
        });
        setColumns((prev) => {
          const next = cloneColumns(prev);
          next[status] = [...next[status], created];
          return next;
        });
      } catch (err) {
        setColumns(previous);
        setError(err.message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [activeColumns, project, secretKey]
  );

  const handleUpdateItem = useCallback(
    async (itemId, updates) => {
      if (!project || !secretKey) return;
      setError('');
      const previous = cloneColumns(activeColumns);
      try {
        setBusy(true);
        const { item: updated } = await api.updateItem(
          project.id,
          secretKey,
          itemId,
          updates
        );
        setColumns((prev) => {
          const next = cloneColumns(prev);
          const status = updated.status;
          next[status] = next[status].map((item) => (item.id === itemId ? updated : item));
          return next;
        });
      } catch (err) {
        setColumns(previous);
        setError(err.message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [activeColumns, project, secretKey]
  );

  const handleDeleteItem = useCallback(
    async (itemId) => {
      if (!project || !secretKey) return;
      setError('');
      const previous = cloneColumns(activeColumns);
      try {
        setBusy(true);
        await api.deleteItem(project.id, secretKey, itemId);
        setColumns((prev) => {
          const next = cloneColumns(prev);
          COLUMN_ORDER.forEach((status) => {
            next[status] = next[status].filter((item) => item.id !== itemId);
          });
          return next;
        });
      } catch (err) {
        setColumns(previous);
        setError(err.message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [activeColumns, project, secretKey]
  );

  const handleDragEnd = useCallback(
    async (result) => {
      if (!project || !secretKey) return;
      const { destination, source, draggableId } = result;
      if (!destination) return;
      if (
        destination.droppableId === source.droppableId &&
        destination.index === source.index
      ) {
        return;
      }

      const previous = cloneColumns(activeColumns);
      const optimistic = cloneColumns(activeColumns);

      const sourceItems = optimistic[source.droppableId];
      const [moved] = sourceItems.splice(source.index, 1);
      if (!moved) return;
      moved.status = destination.droppableId;
      optimistic[destination.droppableId].splice(destination.index, 0, moved);

      setColumns(optimistic);
      setError('');

      try {
        const response = await api.reorderItems(
          project.id,
          secretKey,
          columnsToIds(optimistic)
        );
        setColumns(ensureColumns(response.columns));
      } catch (err) {
        console.error('Reorder failed', err);
        setColumns(previous);
        setError(err.message || 'Failed to update order.');
        // force refresh to keep consistent
        await refreshBoard();
      }
    },
    [activeColumns, project, refreshBoard, secretKey]
  );

  const toggleDensity = useCallback(() => {
    setDensity((prev) => {
      const next = prev === 'compact' ? 'comfortable' : 'compact';
      if (typeof window !== 'undefined') {
        localStorage.setItem('ui-density', next);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    // apply density to root container
    const root = document.documentElement;
    root.setAttribute('data-density', density);
    return () => {
      root.removeAttribute('data-density');
    };
  }, [density]);

  const handleOpenDrawer = useCallback((item) => setDrawerItem(item), []);
  const handleCloseDrawer = useCallback(() => setDrawerItem(null), []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⌁
          </span>
          <div className="brand-copy">
            <h1>Backlog Pilot</h1>
            <p className="tagline">Focus on the work, not the workflow.</p>
          </div>
        </div>
        <div className="header-actions">
          {project ? (
            <>
              <div className="project-pill" role="status" aria-live="polite">
                <ProjectBadge name={project.name} />
                <div>
                  <span className="label">Active board</span>
                  <strong>{project.name}</strong>
                </div>
              </div>
              <button type="button" className="ghost" onClick={clearBoard} disabled={busy}>
                Switch project
              </button>
            </>
          ) : (
            <p className="header-note">Private boards unlock with your shared secret.</p>
          )}
        </div>
      </header>

      {(error || info) && (
        <div className="messages">
          {error && <div className="message error">{error}</div>}
          {info && <div className="message info">{info}</div>}
        </div>
      )}

      <main>
        {!project ? (
          <LandingView
            onAccess={handleAccess}
            onCreate={handleCreateProject}
            busy={busy}
            inviteProjectId={inviteProjectId}
            onClearInvite={handleClearInvite}
          />
        ) : (
          <section className="board">
            <div className="board-toolbar">
              <div className="board-headline">
                <h2>{project.name}</h2>
                <p>Keep delivery flowing with four focused lanes.</p>
                <div className="board-metrics">
                  {statusMetrics.map(({ status, label, count }) => (
                    <div className="metric" key={status}>
                      <span className="metric-label">{label}</span>
                      <span className="metric-value">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="board-actions">
                <ShareLink projectId={project.id} variant="ghost" />
                <button type="button" className="secondary" onClick={toggleDensity} disabled={busy}>
                  {density === 'compact' ? 'Density: Compact' : 'Density: Comfortable'}
                </button>
                <button type="button" className="primary" onClick={refreshBoard} disabled={busy}>
                  {busy ? 'Refreshing…' : 'Refresh board'}
                </button>
              </div>
            </div>

            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="columns">
                {COLUMN_ORDER.map((status) => (
                  <Droppable droppableId={status} key={status}>
                    {(provided, snapshot) => (
                      <div
                        className={`column ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                      >
                        <header>
                          <h3>{COLUMN_LABELS[status]}</h3>
                          <span className="count">{activeColumns[status].length}</span>
                        </header>
                        <div className="column-items">
                          {activeColumns[status].map((item, index) => (
                            <Draggable draggableId={item.id} index={index} key={item.id}>
                              {(dragProvided, dragSnapshot) => (
                                <div
                                  className={`card ${dragSnapshot.isDragging ? 'dragging' : ''}`}
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  onClick={() => handleOpenDrawer(item)}
                                >
                                  <BoardCard
                                    item={item}
                                    busy={busy}
                                    onOpen={handleOpenDrawer}
                                    onDelete={handleDeleteItem}
                                  />
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                        <AddCardForm status={status} onAdd={handleAddItem} busy={busy} />
                      </div>
                    )}
                  </Droppable>
                ))}
              </div>
            </DragDropContext>
            <TaskDrawer
              open={!!drawerItem}
              item={drawerItem}
              busy={busy}
              onClose={handleCloseDrawer}
              onSave={handleUpdateItem}
              onDelete={handleDeleteItem}
            />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
