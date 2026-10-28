"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check, Contrast, Flower2, Moon, Palette, Sun } from "lucide-react";
import "./appearance.css";
import { readBrowserPreference } from "../lib/browser-preferences";

export type Appearance = "light" | "dark" | "warp" | "focus" | "soft";
const key = "projectanvil-appearance";
const appearances: Appearance[] = ["light", "dark", "warp", "focus", "soft"];
const valid = (value: unknown): Appearance =>
  typeof value === "string" && appearances.includes(value as Appearance)
    ? (value as Appearance)
    : "warp";
const options = [
  {
    id: "light" as const,
    label: "Light",
    description: "Light surfaces and dark text.",
    icon: Sun,
    bg: "#f4f6f9",
    sidebar: "#eef0f5",
    panel: "#ffffff",
    text: "#202938",
    accent: "#6853c7",
  },
  {
    id: "dark" as const,
    label: "Dark",
    description: "Charcoal surfaces and cool accents.",
    icon: Moon,
    bg: "#111318",
    sidebar: "#181b22",
    panel: "#191c23",
    text: "#e7eaf0",
    accent: "#92b9ec",
  },
  {
    id: "warp" as const,
    label: "Warp",
    description: "Dark surfaces and violet accents.",
    icon: Palette,
    bg: "#15151a",
    sidebar: "#19191f",
    panel: "#1c1c22",
    text: "#e7e5ed",
    accent: "#b19aff",
  },
  {
    id: "focus" as const,
    label: "Focus",
    description: "Light content with dark navigation.",
    icon: Contrast,
    bg: "#e4e8ee",
    sidebar: "#17191c",
    panel: "#f3f5f8",
    text: "#202e41",
    accent: "#385f87",
  },
  {
    id: "soft" as const,
    label: "Soft",
    description: "Pink surfaces and mauve accents.",
    icon: Flower2,
    bg: "#fff4f7",
    sidebar: "#faf2f6",
    panel: "#fffafd",
    text: "#432b41",
    accent: "#99536f",
  },
];
const ThemeContext = createContext<{
  appearance: Appearance;
  choose: (theme: Appearance) => void;
}>({ appearance: "warp", choose: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>("warp");
  useEffect(() => {
    const apply = (value: Appearance) => {
      document.documentElement.dataset.theme = value;
      setAppearance(value);
    };
    try {
      const stored = readBrowserPreference(key),
        next = valid(stored);
      apply(next);
      if (stored !== next) localStorage.setItem(key, next);
    } catch {
      apply("warp");
    }
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) apply(valid(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const choose = (theme: Appearance) => {
    document.documentElement.dataset.theme = theme;
    setAppearance(theme);
    try {
      localStorage.setItem(key, theme);
    } catch {
      /* The selected appearance still applies when storage is unavailable. */
    }
  };
  return (
    <ThemeContext.Provider value={{ appearance, choose }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppearance() {
  return useContext(ThemeContext);
}

export function AppearancePicker() {
  const { appearance, choose } = useAppearance();
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const navigate = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next = index;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % options.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index - 1 + options.length) % options.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = options.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    choose(options[next].id);
    choices.current[next]?.focus();
  };
  return (
    <div
      className="appearance-options"
      role="radiogroup"
      aria-label="Workspace appearance"
    >
      {options.map((option, index) => (
        <button
          type="button"
          role="radio"
          aria-checked={appearance === option.id}
          tabIndex={appearance === option.id ? 0 : -1}
          key={option.id}
          ref={(element) => {
            choices.current[index] = element;
          }}
          className={
            "appearance-option " +
            (appearance === option.id ? "is-selected" : "")
          }
          onClick={() => choose(option.id)}
          onKeyDown={(event) => navigate(event, index)}
        >
          <div
            className="appearance-preview"
            aria-hidden="true"
            style={{
              background: option.bg,
              borderColor:
                (option.id === "focus" ? "#dce4ee" : option.text) + "25",
            }}
          >
            <div
              className="appearance-preview-sidebar"
              style={{ background: option.sidebar }}
            >
              <i
                style={{
                  background: option.id === "focus" ? "#92b9ec" : option.accent,
                }}
              />
              <span
                style={{
                  background:
                    (option.id === "focus" ? "#dce4ee" : option.text) + "25",
                }}
              />
              <span style={{ background: option.accent + "65" }} />
              <span
                style={{
                  background:
                    (option.id === "focus" ? "#dce4ee" : option.text) + "25",
                }}
              />
            </div>
            <div className="appearance-preview-body">
              <strong style={{ background: option.text + "85" }} />
              <div
                style={{
                  background: option.panel,
                  borderColor: option.text + "20",
                }}
              />
              <section>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      background: option.panel,
                      borderColor: option.text + "20",
                    }}
                  >
                    <i style={{ background: option.accent }} />
                  </span>
                ))}
              </section>
            </div>
          </div>
          <div className="appearance-option-label">
            <option.icon size={16} aria-hidden="true" />
            <strong>{option.label}</strong>
            <span className="appearance-radio" aria-hidden="true">
              {appearance === option.id && <Check size={11} />}
            </span>
          </div>
          <p>{option.description}</p>
        </button>
      ))}
    </div>
  );
}

export function AppearanceMenu() {
  const { appearance, choose } = useAppearance();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const initialFocus = useRef<"selected" | "first" | "last">("selected");
  const menuId = useId();
  const selected = options.find((o) => o.id === appearance)!;
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const openMenu = (focus: "selected" | "first" | "last" = "selected") => {
    initialFocus.current = focus;
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const index =
      initialFocus.current === "first"
        ? 0
        : initialFocus.current === "last"
          ? options.length - 1
          : options.findIndex((option) => option.id === appearance);
    choices.current[index]?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, appearance]);
  const navigate = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const focusedIndex = choices.current.findIndex(
      (choice) => choice === document.activeElement,
    );
    const index = focusedIndex >= 0 ? focusedIndex : 0;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = (index + 1) % options.length;
        break;
      case "ArrowUp":
        next = (index - 1 + options.length) % options.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = options.length - 1;
        break;
      case "Tab":
        // Start native tab navigation from the trigger after the menu unmounts.
        close(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    choices.current[next]?.focus();
  };
  return (
    <div
      className="appearance-menu"
      ref={menu}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          close();
      }}
    >
      <button
        className={"btn-icon appearance-trigger " + (open ? "is-open" : "")}
        type="button"
        ref={trigger}
        title={"Appearance: " + selected.label}
        aria-label={"Appearance: " + selected.label}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-haspopup="menu"
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowDown" ? "first" : "last");
          }
        }}
      >
        <selected.icon size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          id={menuId}
          aria-label="Choose appearance"
          className="appearance-dropdown"
          onKeyDown={navigate}
        >
          <span>APPEARANCE</span>
          {options.map((option, index) => (
            <button
              type="button"
              key={option.id}
              ref={(element) => {
                choices.current[index] = element;
              }}
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={appearance === option.id}
              onClick={() => {
                choose(option.id);
                close(true);
              }}
            >
              <option.icon size={18} aria-hidden="true" />
              <div>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </div>
              {appearance === option.id && (
                <Check size={16} aria-hidden="true" />
              )}
            </button>
          ))}
          <p>Saved on this device</p>
        </div>
      )}
    </div>
  );
}
