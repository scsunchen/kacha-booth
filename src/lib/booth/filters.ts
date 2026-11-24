export type FilterPreset = {
  id: string;
  name: string;
  css: string;
};

export const FILTERS: FilterPreset[] = [
  { id: "plain", name: "原片", css: "none" },
  { id: "warm", name: "暖阳", css: "sepia(0.28) saturate(1.28) contrast(1.05) brightness(1.04)" },
  { id: "cool", name: "冷调", css: "saturate(0.82) hue-rotate(14deg) contrast(1.08) brightness(1.02)" },
  { id: "film", name: "胶片", css: "contrast(1.14) saturate(0.78) sepia(0.22) brightness(0.98)" },
  { id: "mono", name: "黑白", css: "grayscale(1) contrast(1.18) brightness(1.02)" },
  { id: "soft", name: "柔光", css: "brightness(1.1) contrast(0.9) saturate(0.88)" },
  { id: "vivid", name: "鲜艳", css: "saturate(1.65) contrast(1.1) brightness(1.02)" },
  { id: "fade", name: "褪色", css: "contrast(0.88) saturate(0.62) brightness(1.1) sepia(0.12)" },
];

export function filterById(id: string): FilterPreset {
  return FILTERS.find((item) => item.id === id) ?? FILTERS[0];
}
