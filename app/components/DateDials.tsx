// DateDials — three rolling dials (DD / MM / YYYY) for picking a date.
//
// Reusable across screens (PRs "Enter PR", EnterWorkout). A `size` prop
// scales rowH + well widths so each screen can dial in its own footprint
// (e.g. "sm" for the compact EnterWorkout form).
//
// Day/month use min=1 (00 is never a rest row). Year is a real 2000–2099
// band (NOT a 2-digit ring) so the value can't wrap to garbage.
import React from "react";
import { View, StyleSheet } from "react-native";
import DialValue from "./DialValue";

export type DateDialSize = "md" | "sm";

const SIZES = {
  md: { rowH: 34, dw: 52, yw: 72, gap: 14, label: 10 },
  sm: { rowH: 26, dw: 40, yw: 56, gap: 10, label: 9 },
} as const;

interface DateDialsProps {
  day: number;
  month: number;
  year: number;
  onDay: (v: number) => void;
  onMonth: (v: number) => void;
  onYear: (v: number) => void;
  size?: DateDialSize;
}

export function DateDials({ day, month, year, onDay, onMonth, onYear, size = "md" }: DateDialsProps) {
  const s = SIZES[size];
  return (
    <View style={[styles.row, { gap: s.gap }]}>
      <DialValue value={day} min={1} max={31} onChange={onDay} label="Day" rowH={s.rowH} width={s.dw} />
      <DialValue value={month} min={1} max={12} onChange={onMonth} label="Month" rowH={s.rowH} width={s.dw} />
      <DialValue value={year} min={2000} max={2099} onChange={onYear} label="Year" rowH={s.rowH} width={s.yw} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
  },
});
