import { Film, meta as metaFor } from "../../lib/nn-launch/Film";
import document from "./studio.json";

export const meta = metaFor("teaser", 1080, 1920);

export default function Video() {
  return <Film cut="teaser" document={document} />;
}
