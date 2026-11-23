// domino ships no type declarations; the importer reaches it only through convert/dom.ts, which types the parts it uses.
declare module "@mixmark-io/domino" {
  const domino: unknown;
  export default domino;
}
