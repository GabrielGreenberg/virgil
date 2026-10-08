"use client";

import { forwardRef } from "react";
import { Input, type InputProps } from "@/components/field-primitives";

/**
 * The ONE "search the library" box (task 1012). Two views, one view apart,
 * each search the same catalog: the central dashboard's hero search and the
 * catalog list's filter (`LeftList`). Pre-1012 they were two hand-rolled
 * fields with two looks — the dashboard's at `--radius-md` with a focus border
 * from `library.css`, the list's at `--radius-sm` with `outline: "none"` and
 * NO focus state at all (and no accessible name).
 *
 * This owns what makes it the same control: the field chrome (through the
 * shared `Input` primitive — border, radius, the `:focus-visible` thicken) and
 * a REQUIRED accessible name. The BOX — padding, font size, flex vs. full
 * width — stays the call site's, because a hero search and a list-header
 * filter legitimately differ there (same rule `field-primitives.tsx` states).
 */
export interface LibrarySearchInputProps
  extends Omit<InputProps, "type" | "density" | "aria-label"> {
  /** What a screen reader announces. Required: a search box's placeholder is
   *  not its name, and the list filter shipped without one. */
  "aria-label": string;
}

const LibrarySearchInput = forwardRef<HTMLInputElement, LibrarySearchInputProps>(
  function LibrarySearchInput(props, ref) {
    return <Input ref={ref} density="control" {...props} />;
  },
);

export default LibrarySearchInput;
