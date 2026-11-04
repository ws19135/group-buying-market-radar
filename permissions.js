export const ROLES = {
  SYSTEM_ADMIN: {
    label: "系統管理員",
    short: "Admin",
    capabilities: ["view", "review", "approve", "source_admin", "integration_dry_run"]
  },
  OPS_MANAGER: {
    label: "營運主管",
    short: "Manager",
    capabilities: ["view", "review", "approve", "integration_dry_run"]
  },
  OPS_EDITOR: {
    label: "營運編輯",
    short: "Editor",
    capabilities: ["view", "review"]
  },
  FINANCE: {
    label: "財務",
    short: "Finance",
    capabilities: ["view"]
  },
  VENDOR: {
    label: "廠商",
    short: "Vendor",
    capabilities: ["view"]
  },
  HOST: {
    label: "團主／KOL",
    short: "Host",
    capabilities: ["view"]
  }
};

export const PUBLIC_PREVIEW = true;

export function can(role, capability) {
  return Boolean(ROLES[role]?.capabilities.includes(capability));
}

export function getRole(search = "") {
  const requested = new URLSearchParams(search).get("role");
  return ROLES[requested] ? requested : "OPS_MANAGER";
}

export function actionState(role, capability) {
  if (!can(role, capability)) return { enabled: false, reason: "此角色沒有這項權限" };
  return { enabled: false, reason: "公開展示模式：僅顯示 dry-run，不執行寫入" };
}
