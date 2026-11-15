import { AnimatePresence, Reorder, useDragControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ProjectTask } from "../lib/types";

/**
 * A task list the owner fully controls: add, tick, rename (double-click),
 * remove, drag to reorder, clear the finished ones.
 */

export interface TaskActions {
  add: (text: string) => void;
  toggle: (id: string, done: boolean) => void;
  rename: (id: string, text: string) => void;
  remove: (id: string) => void;
  /** Called while dragging (new order) and once more when the drag ends (`commit`). */
  reorder: (tasks: ProjectTask[], commit: boolean) => void;
  clearDone: () => void;
}

interface Props {
  tasks: ProjectTask[];
  actions: TaskActions;
  maxHeight: number;
  placeholder: string;
  autoFocus?: boolean;
}

const MAX_TEXT = 300;

export default function TaskList({ tasks, actions, maxHeight, placeholder, autoFocus }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const latest = useRef(tasks);
  latest.current = tasks;
  const done = tasks.filter((t) => t.done).length;

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 260);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const add = () => {
    const t = text.trim();
    if (!t) return;
    actions.add(t);
    setText("");
    // Keep the newest line in view.
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
  };

  return (
    <div className="tasks">
      {tasks.length === 0 ? (
        <p className="tasks__empty">Nothing here yet.</p>
      ) : (
        <Reorder.Group
          as="ul"
          ref={listRef}
          axis="y"
          values={tasks}
          onReorder={(next) => actions.reorder(next, false)}
          className="tasks__list"
          style={{ maxHeight }}
          layoutScroll
        >
          <AnimatePresence initial={false}>
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} actions={actions} onDrop={() => actions.reorder(latest.current, true)} />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}

      <div className="tasks__add">
        <span className="tasks__plus">+</span>
        <input
          ref={inputRef}
          className="tasks__input"
          placeholder={placeholder}
          value={text}
          maxLength={MAX_TEXT}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            if (e.key === "Escape" && text) {
              e.stopPropagation();
              setText("");
            }
          }}
        />
        <button className="tasks__go" onClick={add} disabled={!text.trim()} title="Add (Enter)">
          Add
        </button>
      </div>

      <div className="tasks__foot">
        <span>{tasks.length === 0 ? "Type above and press Enter" : `${done} of ${tasks.length} done · double-click to rename · drag ⋮⋮ to reorder`}</span>
        {done > 0 && (
          <button className="tasks__clear" onClick={actions.clearDone} title="Remove every finished task">
            Clear done
          </button>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, actions, onDrop }: { task: ProjectTask; actions: TaskActions; onDrop: () => void }) {
  const controls = useDragControls();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const [dragging, setDragging] = useState(false);

  const commit = () => {
    const t = draft.trim();
    setEditing(false);
    if (t && t !== task.text) actions.rename(task.id, t);
    else setDraft(task.text);
  };

  return (
    <Reorder.Item
      as="li"
      value={task}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false);
        onDrop();
      }}
      className={`task ${task.done ? "done" : ""} ${dragging ? "dragging" : ""}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 18, transition: { duration: 0.16 } }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="task__grip" onPointerDown={(e) => controls.start(e)} title="Drag to reorder">
        ⋮⋮
      </span>
      <button
        className="task__check"
        role="checkbox"
        aria-checked={task.done}
        onClick={() => actions.toggle(task.id, !task.done)}
        title={task.done ? "Mark as not done" : "Mark as done"}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.2 8.4l3 3 6.4-7" />
        </svg>
      </button>
      {editing ? (
        <input
          className="task__edit"
          autoFocus
          value={draft}
          maxLength={MAX_TEXT}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(task.text);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="task__text"
          onDoubleClick={() => {
            setDraft(task.text);
            setEditing(true);
          }}
        >
          <span className="task__label">{task.text}</span>
        </span>
      )}
      {!editing && (
        <span className="task__tools">
          <button
            onClick={() => {
              setDraft(task.text);
              setEditing(true);
            }}
            title="Rename"
          >
            ✎
          </button>
          <button className="task__remove" onClick={() => actions.remove(task.id)} title="Remove">
            ✕
          </button>
        </span>
      )}
    </Reorder.Item>
  );
}
