/** Blocking like the pages it sits next to (Next validates the slot with the route) */
export const instant = false;

// The header slot is empty on Min Side pages that add nothing to the header
export default function NoHeaderExtras() {
  return null;
}
