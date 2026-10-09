import { Film, meta as metaFor } from "../../lib/ac-launch/Film";
import document from "./studio.json";

export const meta = metaFor("teaser", 1920, 1080);

export default function Video() {
  return <Film cut="teaser" document={document} />;
}
