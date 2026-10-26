import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ojs-engine: q2 engine extension for Observable JavaScript.
 *
 * Spike stage (tasks 1.3, 1.4): claims `ojs1`/`ojs2`, wraps each owned cell
 * in a marker Div that records its mode, and attaches one html dependency so
 * we can see how q2 emits engine scripts. No compilation yet.
 */


             
                           
                          
                  
                 
                
                       
                      
         
            
                
                       

const MODES                         = { ojs1: "ojs", ojs2: "js" };

// Inlined from `@quarto/api/claims` (`primary(1)`): the package isn't
// published, so an installed q2 can't bundle value imports from it.
const PRIMARY                = { kind: "primary", priority: 1 };

const extDir = join(dirname(fileURLToPath(import.meta.url)), "..");

let quarto                       ;

const CELL = /^```\{(ojs[12])\}[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;

const ojsEngine                           = {
  name: "ojs",
  defaultExt: ".qmd",
  defaultYaml: () => [],
  defaultContent: () => [],
  validExtensions: () => [],
  canFreeze: false,
  generatesFigures: false,

  init(api           )       {
    quarto = api;
  },

  claimsLanguage(language        )                                          {
    return language in MODES ? PRIMARY : false;
  },

  claimsFile()          {
    return false;
  },

  launch(_context                      )                          {
    return {
      name: "ojs",
      canFreeze: false,

      async markdownForFile(file        ) {
        return quarto .mappedString.fromString(readFileSync(file, "utf8"), file);
      },

      async target(file        , _quiet          , markdown )                                       {
        const ms = markdown ?? (await this.markdownForFile(file));
        return { source: file, input: file, markdown: ms, metadata: {}, data: undefined };
      },

      async partitionedMarkdown(file        , _format         )                               {
        const ms = await this.markdownForFile(file);
        return {
          markdown: ms.value,
          yaml: undefined,
          headingText: undefined,
          headingAttr: undefined,
          containsRefs: false,
          srcMarkdownNoYaml: ms.value,
        };
      },

      async execute(opts                )                         {
        let cells = 0;
        const markdown = opts.target.markdown.value.replace(CELL, (_m, lang        , body        ) => {
          cells++;
          return (
            `::: {.ojs-cell data-ojs-mode="${MODES[lang]}"}\n` +
            "```{.ojs-source .js}\n" +
            body +
            "```\n" +
            ":::"
          );
        });
        const result                = { markdown, supporting: [], filters: [] };
        if (cells > 0) {
          (result                                                   ).htmlDependencies = [
            {
              name: "ojs-spike",
              stylesheets: [],
              scripts: [join(extDir, "spike", "probe.js")],
            },
          ];
        }
        return result;
      },
    };
  },
};

export { ojsEngine as default };
