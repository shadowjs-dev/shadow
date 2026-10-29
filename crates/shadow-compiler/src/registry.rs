//! Collision-free import aliases and hoisted templates for one compiled module.

use std::collections::BTreeSet;
use std::rc::Rc;

use crate::fxhash::{FxHashMap, FxHashSet};

use crate::jsutil::json_string;

/// Registry of the helpers, locals, templates and delegated events of one module.
pub struct Registry {
    /// Imports in first-use order: `(module key, name, alias)`.
    imports: Vec<(Option<String>, &'static str, Rc<str>)>,
    /// Helpers of the default module, by name.
    default_index: FxHashMap<&'static str, usize>,
    /// Helpers of another module, by module and name.
    other_index: FxHashMap<(String, &'static str), usize>,
    /// Hoisted templates by flags (0 to 7) and html.
    templates: [FxHashMap<String, String>; 8],
    /// Hoisted static string arrays of the server target, by their text.
    parts: FxHashMap<String, String>,
    locals: FxHashMap<String, String>,
    template_decls: Vec<String>,
    /// Events whose handlers are attached once per document.
    pub delegated: BTreeSet<String>,
    taken: FxHashSet<String>,
    /// The names given to the memos of conditionals so far, in order (`_c$`, `_c$2`, ...).
    memo_names: Vec<String>,
    /// The next number to try as a memo name.
    memo_next: usize,
    template_count: usize,
    parts_count: usize,
    /// The module the runtime helpers are imported from.
    pub module_name: String,
}

impl Registry {
    /// Creates a registry. `taken` holds every `_`/`$` name of the module.
    #[must_use]
    pub fn new(taken: FxHashSet<String>, module_name: String) -> Self {
        Registry {
            imports: Vec::new(),
            default_index: FxHashMap::default(),
            other_index: FxHashMap::default(),
            templates: Default::default(),
            parts: FxHashMap::default(),
            locals: FxHashMap::default(),
            template_decls: Vec::new(),
            delegated: BTreeSet::new(),
            taken,
            memo_names: Vec::new(),
            memo_next: 1,
            template_count: 0,
            parts_count: 0,
            module_name,
        }
    }

    /// Local alias for a runtime helper of the default module; records the import.
    pub fn helper(&mut self, name: &'static str) -> Rc<str> {
        self.helper_from(name, None)
    }

    /// Local alias for a runtime helper, imported from `from` when given.
    pub fn helper_from(&mut self, name: &'static str, from: Option<&str>) -> Rc<str> {
        let existing = match from {
            None => self.default_index.get(name).copied(),
            Some(module) => self.other_index.get(&(module.to_string(), name)).copied(),
        };
        if let Some(index) = existing
            && let Some(entry) = self.imports.get(index)
        {
            return Rc::clone(&entry.2);
        }
        let mut alias = format!("_${name}");
        let mut n = 1;
        while self.taken.contains(&alias) {
            n += 1;
            alias = format!("_${name}{n}");
        }
        self.taken.insert(alias.clone());
        let alias: Rc<str> = Rc::from(alias);
        let position = self.imports.len();
        match from {
            None => {
                self.default_index.insert(name, position);
            }
            Some(module) => {
                self.other_index
                    .insert((module.to_string(), name), position);
            }
        }
        self.imports
            .push((from.map(str::to_string), name, Rc::clone(&alias)));
        alias
    }

    /// True when the module already uses `name` for something of its own (or this registry gave it
    /// out). Generated locals that live inside a function check it, so they never shadow a name that
    /// the user's expressions inside that function read.
    #[must_use]
    pub fn is_taken(&self, name: &str) -> bool {
        self.taken.contains(name)
    }

    /// The name of the `index`-th memo of a conditional (`_c$`, `_c$2`, ...), skipping names the module
    /// already uses. The names are worked out once, in order, so a long chain of conditionals does not
    /// search from the start for each of its links.
    pub fn memo_name(&mut self, index: usize) -> &str {
        while self.memo_names.len() <= index {
            let name = if self.memo_next == 1 {
                "_c$".to_string()
            } else {
                format!("_c${}", self.memo_next)
            };
            self.memo_next += 1;
            if !self.taken.contains(&name) {
                self.memo_names.push(name);
            }
        }
        self.memo_names.get(index).map_or("", String::as_str)
    }

    /// A unique module-level variable name (no import), stable per base name.
    pub fn local(&mut self, base: &str) -> String {
        if let Some(existing) = self.locals.get(base) {
            return existing.clone();
        }
        let mut name = base.to_string();
        while self.taken.contains(&name) {
            name.push('_');
        }
        self.taken.insert(name.clone());
        self.locals.insert(base.to_string(), name.clone());
        name
    }

    /// Hoisted template variable for an HTML string; identical strings share one template.
    pub fn template(&mut self, html: &str, flags: u32) -> String {
        let slot = (flags & 7) as usize;
        if let Some(existing) = self.templates.get(slot).and_then(|map| map.get(html)) {
            return existing.clone();
        }
        self.template_count += 1;
        let mut name = if self.template_count == 1 {
            "_tmpl$".to_string()
        } else {
            format!("_tmpl${}", self.template_count)
        };
        while self.taken.contains(&name) {
            name.push('_');
        }
        self.taken.insert(name.clone());
        if let Some(map) = self.templates.get_mut(slot) {
            map.insert(html.to_string(), name.clone());
        }
        let make = self.helper("template");
        let quoted = json_string(html);
        let args = if flags == 0 {
            quoted
        } else {
            format!("{quoted}, {flags}")
        };
        self.template_decls
            .push(format!("const {name} = /*#__PURE__*/ {make}({args});"));
        name
    }

    /// Hoisted static string array for an SSR template; returns its variable name.
    pub fn hoist_parts(&mut self, statics: &[String]) -> String {
        let mut list = String::from("[");
        for (index, item) in statics.iter().enumerate() {
            if index > 0 {
                list.push(',');
            }
            list.push_str(&json_string(item));
        }
        list.push(']');
        if let Some(existing) = self.parts.get(&list) {
            return existing.clone();
        }
        self.parts_count += 1;
        let mut name = if self.parts_count == 1 {
            "_ssr$".to_string()
        } else {
            format!("_ssr${}", self.parts_count)
        };
        while self.taken.contains(&name) {
            name.push('_');
        }
        self.taken.insert(name.clone());
        self.parts.insert(list.clone(), name.clone());
        self.template_decls.push(format!("const {name} = {list};"));
        name
    }

    /// Import statements plus hoisted template declarations; empty when nothing was generated.
    #[must_use]
    pub fn prelude(&self) -> String {
        if self.imports.is_empty() {
            return String::new();
        }
        // Modules in the order of their first import; the default module is `module_name`.
        let mut modules: Vec<(&str, Vec<String>)> = Vec::new();
        for (from, name, alias) in &self.imports {
            let module = from.as_deref().unwrap_or(&self.module_name);
            let specifier = format!("{name} as {alias}");
            match modules.iter_mut().find(|entry| entry.0 == module) {
                Some(entry) => entry.1.push(specifier),
                None => modules.push((module, vec![specifier])),
            }
        }
        let mut out = String::new();
        for (module, specifiers) in &modules {
            out.push_str("import { ");
            out.push_str(&specifiers.join(", "));
            out.push_str(" } from ");
            out.push_str(&json_string(module));
            out.push_str(";\n");
        }
        for declaration in &self.template_decls {
            out.push_str(declaration);
            out.push('\n');
        }
        out
    }

    /// Statement registering delegated events, appended to the module end.
    pub fn epilogue(&mut self) -> String {
        if self.delegated.is_empty() {
            return String::new();
        }
        let names: Vec<String> = self
            .delegated
            .iter()
            .map(|name| json_string(name))
            .collect();
        let call = self.helper("delegateEvents");
        format!("\n{call}([{}]);\n", names.join(", "))
    }
}
