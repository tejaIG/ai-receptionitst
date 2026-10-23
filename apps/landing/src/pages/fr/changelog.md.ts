import type { APIRoute } from "astro"
import {
  changelogAnchorId,
  changelogPath,
  getChangelogEntries,
} from "@/lib/changelog"
import { markdownResponse } from "@/lib/markdown-response"
import { absoluteUrl } from "@/lib/seo"

export const GET: APIRoute = async () => {
  const entries = await getChangelogEntries("fr")

  const markdown = `# Quoi de neuf avec Palakarimpu AI?

Mises à jour produit, intégrations et améliorations de l'équipe Palakarimpu AI.

## Mises à jour

${entries
  .map(
    (entry) =>
      `- [${entry.data.title}](${absoluteUrl(changelogPath("fr", changelogAnchorId(entry)))}) - ${entry.data.description}`
  )
  .join("\n")}
`

  return markdownResponse({
    markdown,
    canonical: absoluteUrl("/fr/changelog/"),
    title: "Journal des changements Palakarimpu AI",
    description:
      "Suivez les mises à jour produit, améliorations, intégrations et nouveautés de Palakarimpu AI.",
  })
}
