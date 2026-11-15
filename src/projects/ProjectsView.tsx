import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Eye from "../components/Eye";
import { ASPECT } from "../components/eyeArt";
import { api, ELISE_LIST } from "../lib/api";
import type { EyeState, Project, ProjectsBoard, ProjectStatus, ProjectTask } from "../lib/types";
import Starfield from "./Starfield";
import TaskList, { type TaskActions } from "./TaskList";
import "./projects.css";

/**
 * Projects: Elise sits in the middle of a slow starfield and every project is
 * a card wired to her. Press a card and its task list drops down under its
 * name, in front of the others; press Elise and her own list drops down under
 * the eye. The lists are entirely the owner's: add, tick, rename, remove,
 * reorder.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const MOVE = { duration: 0.5, ease: EASE };
const CARD_W = 200;
const OPEN_W = 340;
const HEAD_H = 56;
const MAX_PROJECTS = 14;
export const PROJECT_COLORS = ["#b44cff", "#ff4f6d", "#22b8cf", "#f2a93b", "#4cd6a0", "#5b6cff", "#ff4f8b", "#c9c6d8"];

const STATUS: Record<ProjectStatus, string> = { for_now: "Finished for now", done: "Fully finished" };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Props {
  onClose: () => void;
  onError: (msg: string) => void;
}

interface Slot {
  project: Project;
  right: boolean;
  x: number;
  y: number;
  /** The wire from Elise's eye to the card. */
  d: string;
  /** The same wire collapsed into the eye: where cards fly out from. */
  d0: string;
}

export default function ProjectsView({ onClose, onError }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [board, setBoard] = useState<ProjectsBoard | null>(null);
  /** The open list: a project id, ELISE_LIST, or nothing. */
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [eyeState, setEyeState] = useState<EyeState>("appearing");
  /** After the entrance, moves stop being staggered. */
  const [entered, setEntered] = useState(false);

  const reload = useCallback(() => {
    api
      .projectsGet()
      .then(setBoard)
      .catch((e) => onError(String(e)));
  }, [onError]);
  useEffect(reload, [reload]);

  /** Optimistic: the screen changes at once; on failure, say so and reload the truth. */
  const run = useCallback(
    (p: Promise<unknown>) => {
      p.catch((e) => {
        onError(String(e));
        reload();
      });
    },
    [onError, reload],
  );

  useEffect(() => {
    const t1 = setTimeout(() => setEyeState("idle"), 900);
    const t2 = setTimeout(() => setEntered(true), 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    const el = boxRef.current!;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (adding) setAdding(false);
      else if (open) setOpen(null);
      else onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [adding, open, onClose]);

  // ----- editing -----
  const setTasks = useCallback((listId: string, fn: (t: ProjectTask[]) => ProjectTask[]) => {
    setBoard(
      (b) =>
        b &&
        (listId === ELISE_LIST
          ? { ...b, elise: fn(b.elise) }
          : { ...b, projects: b.projects.map((p) => (p.id === listId ? { ...p, tasks: fn(p.tasks) } : p)) }),
    );
  }, []);

  const actionsFor = useCallback(
    (listId: string): TaskActions => ({
      add: (text) =>
        run(api.taskAdd(listId, text).then((t) => setTasks(listId, (ts) => [...ts, t]))),
      toggle: (id, done) => {
        setTasks(listId, (ts) => ts.map((t) => (t.id === id ? { ...t, done } : t)));
        run(api.taskSetDone(id, done));
      },
      rename: (id, text) => {
        setTasks(listId, (ts) => ts.map((t) => (t.id === id ? { ...t, text } : t)));
        run(api.taskSetText(id, text));
      },
      remove: (id) => {
        setTasks(listId, (ts) => ts.filter((t) => t.id !== id));
        run(api.taskRemove(id));
      },
      reorder: (tasks, commit) => {
        setTasks(listId, () => tasks);
        if (commit) run(api.tasksReorder(listId, tasks.map((t) => t.id)));
      },
      clearDone: () => {
        setTasks(listId, (ts) => ts.filter((t) => !t.done));
        run(api.tasksClearDone(listId));
      },
    }),
    [run, setTasks],
  );

  const addProject = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    setAdding(false);
    run(
      api.projectAdd(name).then((p) => {
        setBoard((b) => b && { ...b, projects: [...b.projects, p] });
        setOpen(p.id);
      }),
    );
  };

  const updateProject = (p: Project, patch: Partial<Pick<Project, "name" | "color">>) => {
    const next = { ...p, ...patch };
    setBoard((b) => b && { ...b, projects: b.projects.map((x) => (x.id === p.id ? next : x)) });
    run(api.projectUpdate(p.id, next.name, next.color));
  };

  const setStatus = (p: Project, status: ProjectStatus | null) => {
    setBoard((b) => b && { ...b, projects: b.projects.map((x) => (x.id === p.id ? { ...x, status } : x)) });
    run(api.projectSetStatus(p.id, status));
  };

  const removeProject = (p: Project) => {
    setOpen(null);
    setBoard((b) => b && { ...b, projects: b.projects.filter((x) => x.id !== p.id) });
    run(api.projectRemove(p.id));
  };

  // ----- layout -----
  const { w, h } = size;
  const eliseOpen = open === ELISE_LIST;
  const eyeW = clamp(w * 0.15, 130, 190);
  const eyeH = eyeW * ASPECT;
  const restY = h / 2 - 6;
  const eye = { x: w / 2, y: eliseOpen ? Math.max(eyeH / 2 + 70, h * 0.19) : restY };
  const listMax = clamp(h - 390, 110, 300);
  const eliseListMax = clamp(h - (eye.y + eyeH / 2 + 62) - 150, 100, 320);

  const slots = useMemo<Slot[]>(() => {
    const projects = board?.projects ?? [];
    const n = projects.length;
    const rx = Math.max(150, Math.min(w * 0.36, w / 2 - CARD_W - 30));
    const ry = h * 0.36;
    return projects.map((project, i) => {
      // Alternate sides, then fan each side out along an arc around her.
      const right = i % 2 === 0;
      const k = right ? Math.ceil(n / 2) : Math.floor(n / 2);
      const j = Math.floor(i / 2);
      const spread = k === 1 ? 0 : Math.min(64, 21 * (k - 1));
      const a = k === 1 ? 0 : ((-spread + (2 * spread * j) / (k - 1)) * Math.PI) / 180;
      const side = right ? 1 : -1;
      let x = w / 2 + side * rx * Math.cos(a);
      let y = restY + ry * Math.sin(a);
      if (open === project.id) {
        // An open card widens and grows downward: keep all of it on screen.
        x = right ? Math.min(x, w - 18 - OPEN_W) : Math.max(x, 18 + OPEN_W);
        const panelH = HEAD_H + 190 + Math.min(listMax, Math.max(1, project.tasks.length) * 38);
        y = Math.max(HEAD_H / 2 + 60, Math.min(y, h - 16 - panelH + HEAD_H / 2));
      }
      const sx = eye.x + side * eyeW * 0.47;
      const sy = eye.y;
      const dx = x - sx;
      const r = (v: number) => Math.round(v * 10) / 10;
      return {
        project,
        right,
        x,
        y,
        d: `M ${r(sx)} ${r(sy)} C ${r(sx + dx * 0.5)} ${r(sy)}, ${r(x - dx * 0.5)} ${r(y)}, ${r(x)} ${r(y)}`,
        d0: `M ${r(sx)} ${r(sy)} C ${r(sx)} ${r(sy)}, ${r(sx)} ${r(sy)}, ${r(sx)} ${r(sy)}`,
      };
    });
  }, [board?.projects, w, h, open, eye.x, eye.y, eyeW, restY, listMax]);

  const delay = (i: number) => (entered ? 0 : 0.35 + i * 0.07);
  const openTasks = board ? board.elise.filter((t) => !t.done).length + board.projects.reduce((n, p) => n + p.tasks.filter((t) => !t.done).length, 0) : 0;
  const eliseDone = board?.elise.filter((t) => t.done).length ?? 0;

  return (
    <motion.div className="projects" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
      <Starfield />

      <div className="projects__hud">
        <button className="btn ghost projects__back" onClick={onClose} title="Back to the calendar (Esc)">
          ‹ Calendar
        </button>
        <div className="projects__title">
          <h2>Projects</h2>
          {board && (
            <span>
              {board.projects.length} {board.projects.length === 1 ? "project" : "projects"} · {openTasks} open {openTasks === 1 ? "task" : "tasks"}
            </span>
          )}
        </div>
        <div className="projects__new">
          <AnimatePresence mode="wait" initial={false}>
            {adding ? (
              <motion.div key="in" className="projects__new-form" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }} transition={{ duration: 0.18 }}>
                <input
                  className="input"
                  autoFocus
                  placeholder="Project name"
                  value={newName}
                  maxLength={40}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addProject()}
                />
                <button className="btn primary" onClick={addProject} disabled={!newName.trim()}>
                  Add
                </button>
                <button className="btn ghost icon" onClick={() => setAdding(false)} title="Cancel">
                  ✕
                </button>
              </motion.div>
            ) : (
              <motion.button
                key="btn"
                className="btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                onClick={() => setAdding(true)}
                disabled={!board || board.projects.length >= MAX_PROJECTS}
                title={board && board.projects.length >= MAX_PROJECTS ? `At most ${MAX_PROJECTS} projects` : "Add a project"}
              >
                + Project
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="projects__space" ref={boxRef} onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
        {w > 0 && board && (
          <>
            <svg className="projects__links" width={w} height={h} aria-hidden>
              {slots.map((s, i) => {
                const active = open === s.project.id || hover === s.project.id;
                return (
                  <g key={s.project.id} style={{ color: s.project.color }}>
                    <motion.path
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      initial={{ d: s.d0, opacity: 0 }}
                      animate={{ d: s.d, opacity: active ? 0.95 : open ? 0.12 : 0.34, strokeWidth: active ? 1.7 : 1 }}
                      transition={{ ...MOVE, delay: delay(i) }}
                    />
                    {active && <motion.path className="projects__flow" fill="none" stroke="#fff" strokeLinecap="round" initial={{ d: s.d, opacity: 0 }} animate={{ d: s.d, opacity: 0.8 }} transition={MOVE} />}
                  </g>
                );
              })}
            </svg>

            {/* Elise, in the middle */}
            <motion.div
              className={`pelise ${eliseOpen ? "open" : ""}`}
              style={{ zIndex: eliseOpen ? 30 : 12 }}
              initial={{ x: eye.x, y: eye.y, opacity: 0 }}
              animate={{ x: eye.x, y: eye.y, opacity: open && !eliseOpen ? 0.5 : 1 }}
              transition={MOVE}
            >
              <div className="pelise__eye" style={{ width: eyeW, height: eyeH, marginLeft: -eyeW / 2, marginTop: -eyeH / 2 }}>
                <Eye state={eyeState} size={eyeW} onClick={() => setOpen(eliseOpen ? null : ELISE_LIST)} title="Elise's own list" />
              </div>
              <button className="pelise__label" style={{ top: eyeH / 2 + 16 }} onClick={() => setOpen(eliseOpen ? null : ELISE_LIST)}>
                <b>Elise</b>
                <span>{board.elise.length === 0 ? "her own list" : `${eliseDone}/${board.elise.length}`}</span>
              </button>
              <AnimatePresence>
                {eliseOpen && (
                  <motion.div
                    className="pelise__panel"
                    style={{ top: eyeH / 2 + 58 }}
                    initial={{ opacity: 0, y: -14, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.18 } }}
                    transition={{ ...MOVE, delay: 0.12 }}
                  >
                    <TaskList tasks={board.elise} actions={actionsFor(ELISE_LIST)} maxHeight={eliseListMax} placeholder="Add a task for yourself…" autoFocus />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* the projects around her */}
            <AnimatePresence>
              {slots.map((s, i) => (
                <ProjectCard
                  key={s.project.id}
                  slot={s}
                  from={eye}
                  isOpen={open === s.project.id}
                  dim={open !== null && open !== s.project.id}
                  delay={delay(i)}
                  listMax={listMax}
                  actions={actionsFor(s.project.id)}
                  onToggle={() => setOpen(open === s.project.id ? null : s.project.id)}
                  onHover={(on) => setHover(on ? s.project.id : (cur) => (cur === s.project.id ? null : cur))}
                  onUpdate={(patch) => updateProject(s.project, patch)}
                  onStatus={(st) => setStatus(s.project, st)}
                  onRemove={() => removeProject(s.project)}
                />
              ))}
            </AnimatePresence>

            {board.projects.length === 0 && (
              <motion.p className="projects__empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}>
                No projects yet. Add your first one with <b>+ Project</b>.
              </motion.p>
            )}
          </>
        )}
      </div>

      <div className="projects__hint">{open ? "Esc closes the list" : "Press a project, or Elise, to open its list"}</div>
    </motion.div>
  );
}

interface CardProps {
  slot: Slot;
  from: { x: number; y: number };
  isOpen: boolean;
  dim: boolean;
  delay: number;
  listMax: number;
  actions: TaskActions;
  onToggle: () => void;
  onHover: (on: boolean) => void;
  onUpdate: (patch: Partial<Pick<Project, "name" | "color">>) => void;
  onStatus: (status: ProjectStatus | null) => void;
  onRemove: () => void;
}

function ProjectCard({ slot, from, isOpen, dim, delay, listMax, actions, onToggle, onHover, onUpdate, onStatus, onRemove }: CardProps) {
  const p = slot.project;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const [confirm, setConfirm] = useState(false);
  const done = p.tasks.filter((t) => t.done).length;
  const total = p.tasks.length;

  useEffect(() => {
    if (!isOpen) {
      setRenaming(false);
      setConfirm(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  const commitName = () => {
    const n = name.trim();
    setRenaming(false);
    if (n && n !== p.name) onUpdate({ name: n });
    else setName(p.name);
  };

  return (
    <motion.div
      className={`pcard-anchor ${slot.right ? "right" : "left"} ${isOpen ? "open" : ""} ${p.status ? `is-${p.status}` : ""}`}
      style={{ zIndex: isOpen ? 30 : 10, ["--accent" as string]: p.color }}
      initial={{ x: from.x, y: from.y, opacity: 0, scale: 0.5 }}
      animate={{ x: slot.x, y: slot.y, opacity: dim ? 0.3 : 1, scale: 1 }}
      exit={{ x: from.x, y: from.y, opacity: 0, scale: 0.5, transition: { duration: 0.3 } }}
      transition={{ ...MOVE, delay }}
    >
      <motion.div
        className="pcard"
        initial={false}
        animate={{ width: isOpen ? OPEN_W : CARD_W }}
        transition={MOVE}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        <span className="pcard__node" />
        <AnimatePresence>
          {p.status && (
            <motion.span
              key={p.status}
              className="pcard__tag"
              initial={{ opacity: 0, y: 6, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.85, transition: { duration: 0.15 } }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {p.status === "done" ? "✓ " : ""}
              {STATUS[p.status]}
            </motion.span>
          )}
        </AnimatePresence>
        <div className="pcard__head" onClick={() => !renaming && onToggle()} role="button" title={isOpen ? "Close" : `Open ${p.name}`}>
          {renaming ? (
            <input
              className="pcard__rename"
              autoFocus
              value={name}
              maxLength={40}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setName(p.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <span className="pcard__name">{p.name}</span>
          )}
          <span className="pcard__count">{total === 0 ? "—" : `${done}/${total}`}</span>
          <span className="pcard__bar">
            <motion.i initial={false} animate={{ width: total ? `${(done / total) * 100}%` : "0%" }} transition={MOVE} />
          </span>
        </div>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              className="pcard__body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.28, ease: EASE } }}
              transition={MOVE}
            >
              <div className="pcard__inner">
                <div className="pcard__tools">
                  <div className="pcard__swatches">
                    {PROJECT_COLORS.map((c) => (
                      <button key={c} className={c === p.color ? "on" : ""} style={{ background: c }} onClick={() => onUpdate({ color: c })} title="Card colour" />
                    ))}
                  </div>
                  <button
                    className="pcard__tool"
                    onClick={() => {
                      setName(p.name);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </button>
                  <button className={`pcard__tool danger ${confirm ? "sure" : ""}`} onClick={() => (confirm ? onRemove() : setConfirm(true))}>
                    {confirm ? "Really delete?" : "Delete"}
                  </button>
                </div>
                <div className="pcard__status">
                  {(Object.keys(STATUS) as ProjectStatus[]).map((st) => (
                    <button
                      key={st}
                      className={`pcard__chip ${st} ${p.status === st ? "on" : ""}`}
                      onClick={() => onStatus(p.status === st ? null : st)}
                      title={p.status === st ? "Remove this tag" : `Tag as: ${STATUS[st]}`}
                    >
                      <i />
                      {STATUS[st]}
                    </button>
                  ))}
                </div>
                <TaskList tasks={p.tasks} actions={actions} maxHeight={listMax} placeholder={`Add a task for ${p.name}…`} autoFocus />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
