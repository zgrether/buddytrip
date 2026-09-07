/**
 * THE ONE PLACE THE THEME ROW IS HIDDEN.
 *
 * Light mode ships as a survey instrument: the switch exists so the Cup
 * surfaces can be walked in light and the bypass list checked against what the
 * eye sees. If that list turns out to be long, the row comes out of the account
 * menu and the work continues behind it — flip this to `false` and nothing else
 * changes.
 *
 * It is a module of its own, and deliberately so. The switch
 * (`src/lib/theme.ts`) must not be able to depend on menu visibility, or
 * "hidden" would quietly mean "disabled" — which is precisely the fallback this
 * exists to keep available. The dependency arrow points one way: the menu row
 * imports this AND the switch; the switch imports neither; the provider imports
 * only the switch. `theme.test.ts` guards all three directions.
 */
export const THEME_MENU_VISIBLE = true;
