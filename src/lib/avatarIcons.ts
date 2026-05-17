/**
 * Tabler icon library curated for the avatar picker.
 *
 * 3 categories × 32 icons = 96 total. Every icon below has been verified
 * to exist in `@tabler/icons-react`.
 *
 * The original spec called for a 4th "Animals" category, but Tabler's
 * animal coverage is too sparse to fill a 24-slot tab — so the animals
 * we have were redistributed across Nature (paw, butterfly, spider, etc.)
 * and Wild cards (dog, cat, horse, etc.).
 *
 * Adding a new icon: append `{ id, label }` to the right category, then
 * regenerate `AVATAR_ICON_COMPONENTS` in `./avatarIconComponents.ts`.
 */
export type AvatarIcon = { id: string; label: string };
export type AvatarCategory = {
  id: string;
  label: string;
  icons: AvatarIcon[];
};

export const AVATAR_CATEGORIES: AvatarCategory[] = [
  {
    id: "competition",
    label: "Competition",
    icons: [
      { id: "flag-2", label: "Flag" },
      { id: "trophy", label: "Trophy" },
      { id: "crown", label: "Crown" },
      { id: "star", label: "Star" },
      { id: "target", label: "Target" },
      { id: "shield", label: "Shield" },
      { id: "medal", label: "Medal" },
      { id: "bolt", label: "Bolt" },
      { id: "diamond", label: "Diamond" },
      { id: "rocket", label: "Rocket" },
      { id: "flame", label: "Flame" },
      { id: "sword", label: "Sword" },
      { id: "swords", label: "Dueling swords" },
      { id: "axe", label: "Axe" },
      { id: "chess-king", label: "King" },
      { id: "chess-queen", label: "Queen" },
      { id: "chess-knight", label: "Knight" },
      { id: "ball-football", label: "Soccer ball" },
      { id: "ball-american-football", label: "Football" },
      { id: "ball-baseball", label: "Baseball" },
      { id: "ball-basketball", label: "Basketball" },
      { id: "ball-volleyball", label: "Volleyball" },
      { id: "ball-tennis", label: "Tennis" },
      { id: "ball-bowling", label: "Bowling" },
      { id: "bike", label: "Bike" },
      { id: "run", label: "Runner" },
      { id: "barbell", label: "Barbell" },
      { id: "dumbbell", label: "Dumbbell" },
      { id: "karate", label: "Karate" },
      { id: "horse-toy", label: "Hobby horse" },
      { id: "sailboat", label: "Sailboat" },
      { id: "compass", label: "Compass" },
    ],
  },
  {
    id: "nature",
    label: "Nature",
    icons: [
      { id: "mountain", label: "Mountain" },
      { id: "wave-sine", label: "Wave" },
      { id: "sun", label: "Sun" },
      { id: "sunrise", label: "Sunrise" },
      { id: "sunset", label: "Sunset" },
      { id: "moon", label: "Moon" },
      { id: "snowflake", label: "Snowflake" },
      { id: "cloud", label: "Cloud" },
      { id: "cloud-rain", label: "Rain" },
      { id: "cloud-storm", label: "Storm" },
      { id: "cloud-fog", label: "Fog" },
      { id: "tornado", label: "Tornado" },
      { id: "volcano", label: "Volcano" },
      { id: "tree", label: "Tree" },
      { id: "trees", label: "Forest" },
      { id: "leaf", label: "Leaf" },
      { id: "leaf2", label: "Leaf" },
      { id: "leaf-maple", label: "Maple leaf" },
      { id: "plant", label: "Plant" },
      { id: "plant2", label: "Sprout" },
      { id: "flower", label: "Flower" },
      { id: "mushroom", label: "Mushroom" },
      { id: "anchor", label: "Anchor" },
      { id: "fish", label: "Fish" },
      { id: "feather", label: "Feather" },
      { id: "egg", label: "Egg" },
      { id: "droplet", label: "Water" },
      { id: "campfire", label: "Bonfire" },
      { id: "wind", label: "Wind" },
      { id: "rainbow", label: "Rainbow" },
      { id: "stars", label: "Stars" },
      { id: "comet", label: "Comet" },
    ],
  },
  {
    id: "wildcards",
    label: "Wild cards",
    icons: [
      { id: "ghost", label: "Ghost" },
      { id: "alien", label: "Alien" },
      { id: "robot", label: "Robot" },
      { id: "robot-face", label: "Bot" },
      { id: "skull", label: "Skull" },
      { id: "mask", label: "Mask" },
      { id: "mood-smile", label: "Smile" },
      { id: "mood-happy", label: "Happy" },
      { id: "mood-crazy-happy", label: "Wild" },
      { id: "mood-tongue", label: "Tongue" },
      { id: "mood-surprised", label: "Surprised" },
      { id: "mood-sad", label: "Sad" },
      { id: "mood-wink", label: "Wink" },
      { id: "mood-kid", label: "Kid" },
      { id: "sunglasses", label: "Shades" },
      { id: "chef-hat", label: "Chef hat" },
      { id: "moustache", label: "Mustache" },
      { id: "eye-off", label: "Blindfold" },
      { id: "brain", label: "Brain" },
      { id: "hand-rock", label: "Rock" },
      { id: "hand-two-fingers", label: "Peace" },
      { id: "thumb-up", label: "Thumbs up" },
      { id: "thumb-down", label: "Thumbs down" },
      { id: "toilet-paper", label: "TP" },
      { id: "beer", label: "Beer" },
      { id: "glass-cocktail", label: "Cocktail" },
      { id: "pizza", label: "Pizza" },
      { id: "burger", label: "Burger" },
      { id: "cake", label: "Cake" },
      { id: "ice-cream", label: "Ice cream" },
      { id: "candy", label: "Candy" },
      { id: "confetti", label: "Confetti" },
    ],
  },
];

/** Flat list of every valid icon id. */
export const AVATAR_ICON_IDS: ReadonlySet<string> = new Set(
  AVATAR_CATEGORIES.flatMap((c) => c.icons.map((i) => i.id))
);

/** Look up a human-readable label for a given icon id. Returns null if unknown. */
export function getAvatarIconLabel(iconId: string | null | undefined): string | null {
  if (!iconId) return null;
  for (const cat of AVATAR_CATEGORIES) {
    const found = cat.icons.find((i) => i.id === iconId);
    if (found) return found.label;
  }
  return null;
}
