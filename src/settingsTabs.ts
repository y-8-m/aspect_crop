type SettingsTab = "general" | "aspect";

export function createSettingsTabs(root: HTMLElement) {
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-settings-tab]"));

  function select(name: SettingsTab, focus = false): void {
    for (const tab of tabs) {
      const selected = tab.dataset.settingsTab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = root.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`);
      if (panel) panel.hidden = !selected;
      if (selected && focus) tab.focus();
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab.dataset.settingsTab as SettingsTab));
    tab.addEventListener("keydown", (event) => {
      let target: number;
      switch (event.key) {
        case "ArrowRight": target = (index + 1) % tabs.length; break;
        case "ArrowLeft": target = (index + tabs.length - 1) % tabs.length; break;
        case "Home": target = 0; break;
        case "End": target = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      select(tabs[target].dataset.settingsTab as SettingsTab, true);
    });
  });

  return { select };
}
