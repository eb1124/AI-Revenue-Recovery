"""Direct costs per action (section 4.1's cost column) — shared by decide.py and ml/train.py's off-policy evaluation."""

from app.models.enums import Action

# Paise. NUDGE_INCENTIVE's discount itself is a separate, per-event cost
# (`incentive_cost_paise` in 4.2's EV equation, sized by decide.py's 4.6
# search) — this table is only ever the fixed dispatch cost of the action
# itself (gateway fee, message send, human time), never the incentive.
ACTION_DIRECT_COST_PAISE: dict[Action, float] = {
    Action.HOLD: 0.0,
    Action.RETRY_NOW: 2.0,
    Action.RETRY_SCHEDULED: 2.0,
    Action.NUDGE_FREE: 35.0,
    Action.NUDGE_INCENTIVE: 35.0,
    Action.ESCALATE_HUMAN: 8500.0,
}
