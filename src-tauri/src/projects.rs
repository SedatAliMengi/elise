//! Projects: Elise in the middle, every project a card around her, each with a
//! task list the owner fully controls (add, tick, rename, remove, reorder).
//! Elise has a list of her own too, stored under the list id [`ELISE_LIST`].

use serde::Serialize;

use crate::db::Db;

/// The id of Elise's own list (not a project).
pub const ELISE_LIST: &str = "elise";
pub const MAX_PROJECTS: usize = 14;
const MAX_NAME: usize = 40;
const MAX_TEXT: usize = 300;
/// Tag: "Finished for now".
pub const FOR_NOW: &str = "for_now";
/// Tag: "Fully finished".
pub const DONE: &str = "done";
/// Card colours, handed out in turn to new projects.
pub const COLORS: [&str; 8] = ["#b44cff", "#ff4f6d", "#22b8cf", "#f2a93b", "#4cd6a0", "#5b6cff", "#ff4f8b", "#c9c6d8"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTask {
    pub id: String,
    pub project_id: String,
    pub text: String,
    pub done: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    /// A tag the owner sets and clears at will: [`FOR_NOW`], [`DONE`], or none.
    pub status: Option<String>,
    pub tasks: Vec<ProjectTask>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsBoard {
    pub elise: Vec<ProjectTask>,
    pub projects: Vec<Project>,
}

fn clean(text: &str, max: usize, empty: &str) -> Result<String, String> {
    let t = text.trim();
    if t.is_empty() {
        return Err(empty.into());
    }
    Ok(t.chars().take(max).collect())
}

fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

fn check_list(db: &Db, list: &str) -> Result<(), String> {
    if list == ELISE_LIST || db.project_exists(list)? {
        Ok(())
    } else {
        Err("That project no longer exists.".into())
    }
}

pub fn board(db: &Db) -> Result<ProjectsBoard, String> {
    Ok(ProjectsBoard { elise: db.project_tasks(ELISE_LIST)?, projects: db.projects()? })
}

pub fn add_project(db: &Db, name: &str) -> Result<Project, String> {
    let name = clean(name, MAX_NAME, "Give the project a name.")?;
    let n = db.project_count()?;
    if n >= MAX_PROJECTS {
        return Err(format!("At most {MAX_PROJECTS} projects fit around Elise."));
    }
    db.project_add(&name, COLORS[n % COLORS.len()])
}

pub fn update_project(db: &Db, id: &str, name: &str, color: &str) -> Result<(), String> {
    let name = clean(name, MAX_NAME, "Give the project a name.")?;
    if !is_color(color) {
        return Err("That is not a colour.".into());
    }
    db.project_update(id, &name, color)
}

/// Tag a project as finished for now / fully finished, or clear the tag (`None`).
pub fn set_status(db: &Db, id: &str, status: Option<&str>) -> Result<(), String> {
    match status {
        None | Some(FOR_NOW) | Some(DONE) => db.project_set_status(id, status),
        Some(_) => Err("Unknown tag.".into()),
    }
}

pub fn add_task(db: &Db, list: &str, text: &str) -> Result<ProjectTask, String> {
    check_list(db, list)?;
    let text = clean(text, MAX_TEXT, "Write something to add.")?;
    db.task_add(list, &text)
}

pub fn set_text(db: &Db, id: &str, text: &str) -> Result<(), String> {
    let text = clean(text, MAX_TEXT, "A task cannot be empty.")?;
    db.task_set_text(id, &text)
}

/// Put a list's tasks in the given order. Ids that are not in the list are
/// ignored; tasks that are not mentioned keep their place after the others.
pub fn reorder(db: &Db, list: &str, ids: &[String]) -> Result<(), String> {
    check_list(db, list)?;
    db.tasks_reorder(list, ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(tasks: &[ProjectTask]) -> Vec<&str> {
        tasks.iter().map(|t| t.text.as_str()).collect()
    }

    #[test]
    fn projects_and_their_lists() {
        let db = Db::memory().unwrap();
        assert!(board(&db).unwrap().projects.is_empty());

        let a = add_project(&db, "  Cipher  ").unwrap();
        let b = add_project(&db, "Iris").unwrap();
        assert_eq!(a.name, "Cipher");
        assert_eq!((a.color.as_str(), b.color.as_str()), (COLORS[0], COLORS[1]));
        assert!(add_project(&db, "   ").is_err());

        add_task(&db, &a.id, "one").unwrap();
        let two = add_task(&db, &a.id, " two ").unwrap();
        add_task(&db, &a.id, "three").unwrap();
        add_task(&db, ELISE_LIST, "mine").unwrap();
        assert!(add_task(&db, "nope", "x").is_err());
        assert!(add_task(&db, &a.id, "  ").is_err());

        db.task_set_done(&two.id, true).unwrap();
        set_text(&db, &two.id, "second").unwrap();
        assert!(set_text(&db, &two.id, " ").is_err());

        let v = board(&db).unwrap();
        assert_eq!(texts(&v.elise), ["mine"]);
        assert_eq!(texts(&v.projects[0].tasks), ["one", "second", "three"]);
        assert!(v.projects[0].tasks[1].done);
        assert!(v.projects[1].tasks.is_empty());

        // Reorder: last first; an unknown id is ignored.
        let ids: Vec<String> = vec![v.projects[0].tasks[2].id.clone(), "ghost".into(), v.projects[0].tasks[0].id.clone()];
        reorder(&db, &a.id, &ids).unwrap();
        assert_eq!(texts(&db.project_tasks(&a.id).unwrap()), ["three", "one", "second"]);

        db.tasks_clear_done(&a.id).unwrap();
        assert_eq!(texts(&db.project_tasks(&a.id).unwrap()), ["three", "one"]);

        update_project(&db, &b.id, "Iris 2", "#112233").unwrap();
        assert!(update_project(&db, &b.id, "Iris", "red").is_err());
        assert_eq!(db.projects().unwrap()[1].name, "Iris 2");

        // Tags come and go freely; only the two known ones are accepted.
        assert_eq!(db.projects().unwrap()[1].status, None);
        set_status(&db, &b.id, Some(FOR_NOW)).unwrap();
        assert_eq!(db.projects().unwrap()[1].status.as_deref(), Some(FOR_NOW));
        set_status(&db, &b.id, Some(DONE)).unwrap();
        assert_eq!(db.projects().unwrap()[1].status.as_deref(), Some(DONE));
        assert!(set_status(&db, &b.id, Some("whatever")).is_err());
        set_status(&db, &b.id, None).unwrap();
        assert_eq!(db.projects().unwrap()[1].status, None);

        // Removing a project takes its tasks with it, and nothing else.
        db.project_remove(&a.id).unwrap();
        let v = board(&db).unwrap();
        assert_eq!(v.projects.len(), 1);
        assert!(db.project_tasks(&a.id).unwrap().is_empty());
        assert_eq!(texts(&v.elise), ["mine"]);
    }

    #[test]
    fn project_limit() {
        let db = Db::memory().unwrap();
        for i in 0..MAX_PROJECTS {
            add_project(&db, &format!("P{i}")).unwrap();
        }
        assert!(add_project(&db, "one too many").is_err());
    }
}
