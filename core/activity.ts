/** Auditoria: o que pode aparecer na trilha de atividade e como agrupar. */
export const ACTIVITY_GROUPS = {
  items: {
    label: "Produtos",
    actions: [
      "item_created",
      "item_updated",
      "item_status",
      "item_deleted",
      "cost_added",
      "cost_deleted",
      "photo_added",
      "photo_deleted",
      "photo_cover",
      "item_grouped",
      "item_ungrouped",
    ],
  },
  sales: { label: "Vendas", actions: ["item_sold", "item_unsold", "installment_paid", "installment_unpaid"] },
  access: {
    label: "Acessos",
    actions: [
      "account_created",
      "login",
      "login_failed",
      "login_blocked",
      "logout",
      "password_changed",
      "password_change_failed",
      "preferences_updated",
    ],
  },
  admin: {
    label: "Administração",
    actions: [
      "admin_user_created",
      "admin_user_deleted",
      "admin_user_blocked",
      "admin_user_unblocked",
      "admin_password_reset",
      "admin_plan_changed",
      "admin_signup_opened",
      "admin_signup_closed",
    ],
  },
  exports: {
    label: "Exportações",
    actions: ["export_inventory", "admin_export_items", "admin_export_activity"],
  },
} as const;
export type ActivityGroup = keyof typeof ACTIVITY_GROUPS;
export type ActivityAction =
  (typeof ACTIVITY_GROUPS)[ActivityGroup]["actions"][number];

export const ACTION_LABELS: Record<ActivityAction, string> = {
  item_created: "Produto cadastrado",
  item_updated: "Produto editado",
  item_status: "Etapa alterada",
  item_deleted: "Produto excluído",
  cost_added: "Custo adicionado",
  cost_deleted: "Custo removido",
  photo_added: "Foto adicionada",
  photo_deleted: "Foto removida",
  photo_cover: "Capa trocada",
  item_grouped: "Unidades juntadas",
  item_ungrouped: "Unidade separada",
  item_sold: "Venda registrada",
  item_unsold: "Venda desfeita",
  installment_paid: "Parcela recebida",
  installment_unpaid: "Recebimento desfeito",
  account_created: "Conta criada",
  login: "Entrou",
  login_failed: "Senha errada",
  login_blocked: "Acesso bloqueado",
  logout: "Saiu",
  password_changed: "Senha trocada",
  password_change_failed: "Troca de senha recusada",
  preferences_updated: "Preferências",
  admin_user_created: "Usuário cadastrado",
  admin_user_deleted: "Conta excluída",
  admin_user_blocked: "Usuário bloqueado",
  admin_user_unblocked: "Usuário liberado",
  admin_password_reset: "Senha redefinida",
  admin_plan_changed: "Plano alterado",
  admin_signup_opened: "Cadastro aberto",
  admin_signup_closed: "Cadastro fechado",
  export_inventory: "Planilha exportada",
  admin_export_items: "Produtos exportados",
  admin_export_activity: "Auditoria exportada",
};

export function groupOf(action: string): ActivityGroup | null {
  for (const [group, { actions }] of Object.entries(ACTIVITY_GROUPS))
    if ((actions as readonly string[]).includes(action))
      return group as ActivityGroup;
  return null;
}

/** Ações que merecem atenção do dono (tentativas recusadas, exclusões). */
export const WARNING_ACTIONS: readonly string[] = [
  "login_failed",
  "login_blocked",
  "password_change_failed",
  "item_deleted",
  "admin_user_deleted",
  "admin_user_blocked",
];
