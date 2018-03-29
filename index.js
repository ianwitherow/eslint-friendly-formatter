/**
 * Based on Stylish reporter from Sindre Sorhus
 */
"use strict";

let chalk = require("chalk"),
  stripAnsi = require("strip-ansi"),
  table = require("text-table"),
  extend = require("extend");

let path = require("path");

let process = require("./process");
let minimist = require("minimist");
let clsc = require("coalescy");

let fromGulp = process.argv.some(a => a.indexOf("gulp") > -1);

// ------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------

/**
 * Given a word and a count, append an s if count is not one.
 * @param {string} word A word in its singular form.
 * @param {int} count A number controlling whether word should be pluralized.
 * @returns {string} The original word with an s on the end if count is not one.
 */
function pluralize(word, count) {
  return (count === 1 ? word : word + "s");
}

let parseBoolEnvVar = function(varName) {
  let env = process.env || { };
  return env[varName] === "true";
};

let subtleLog = function(args) {
  return parseBoolEnvVar("EFF_NO_GRAY") ? args : chalk.gray(args);
};

let getEnvVar = function(varName) {
  let env = process.env || { };
  return env[varName] || false;
};

let getFileLink = function(_path, line, column) {
  let scheme = getEnvVar("EFF_EDITOR_SCHEME");
  if (scheme === false) {
    return false;
  }
  return scheme.replace("{file}", encodeURIComponent(_path)).replace("{line}", line).replace("{column}", column);
};

let getKeyLink = function(key) {
  let noLinkRules = parseBoolEnvVar("EFF_NO_LINK_RULES");
  let url = key.indexOf("/") > -1 ? "https://google.com/#q=" : "http://eslint.org/docs/rules/";
  return (!noLinkRules) ? chalk.underline(subtleLog(url + chalk.white(encodeURIComponent(key)))) : chalk.white(key);
};

let printSummary = function(hash, title, method) {
  let res = "\n\n" + chalk[method](title + ":") + chalk.white("\n");
  res += table(
    Object.keys(hash).sort(function(a, b) {
      return hash[a] > hash[b] ? -1 : 1;
    }).map(function(key) {
      return [
        "",
        hash[key],
        getKeyLink(key)
      ];
    }), {
      align: [
        "",
        "r",
        "l"
      ],
      stringLength: function(str) {
        return stripAnsi(str).length;
      }
    });
  return res;
};

// ------------------------------------------------------------------------------
// Public Interface
// ------------------------------------------------------------------------------

module.exports = function(results) {
  let output = "\n",
    success = (fromGulp ? "" : "\n") + chalk.green("✔") + chalk.gray("  Success!"),
    total = 0,
    errors = 0,
    warnings = 0,
    fixableErrors = 0,
    fixableWarnings = 0,
    fixedFiles = 0,
    summaryColor = "yellow",
    fixedColor = "gray";

  results = results || [];

  let entries = [];

  let absolutePathsToFile = parseBoolEnvVar("EFF_ABSOLUTE_PATHS");

  let restArgs = process.argv.slice(process.argv.indexOf("--") + 1);
  let parsedArgs = minimist(restArgs);

  let groupByIssue = parsedArgs["eff-by-issue"];
  let filterRule = parsedArgs["eff-filter"];

  absolutePathsToFile = clsc(parsedArgs["eff-absolute-paths"], absolutePathsToFile);

  let errorsHash = { };
  let warningsHash = { };

  results.forEach(function(result) {
    let messages = result.messages || [];
    fixableErrors += result.fixableErrorCount;
    fixableWarnings += result.fixableWarningCount;
    if (result.hasOwnProperty("output")) {
      fixedFiles++;
    }

    entries = entries.concat(messages.map(function(message) {
      return extend({
        filePath: absolutePathsToFile ? path.resolve(result.filePath) : path.relative(".", result.filePath)
      }, message);
    }));
  });

  entries.sort(function(a, b) {
    if (a.severity > b.severity) {
      return 1;
    }
    if (a.severity < b.severity) {
      return -1;
    }

    if (groupByIssue) {
      if (a.ruleId > b.ruleId) {
        return 1;
      }
      if (a.ruleId < b.ruleId) {
        return -1;
      }
    }

    let pathSort = a.filePath.localeCompare(b.filePath);
    if (pathSort) {
      return pathSort;
    }

    if (a.line > b.line) {
      return 1;
    }
    if (a.line < b.line) {
      return -1;
    }

    if (a.column > b.column) {
      return 1;
    }
    if (a.column < b.column) {
      return -1;
    }

    return 0;
  });

  output += table(
    entries.reduce(function(seq, message) {
      let messageType;

      if (filterRule) {
        if (message.ruleId !== filterRule) {
          return seq;
        }
      }

      if (message.fatal || message.severity === 2) {
        messageType = chalk.red("✘");
        summaryColor = "red";
        errorsHash[message.ruleId] = (errorsHash[message.ruleId] || 0) + 1;
        errors++;
      } else {
        messageType = chalk.yellow("⚠");
        warningsHash[message.ruleId] = (warningsHash[message.ruleId] || 0) + 1;
        warnings++;
      }

      let line = message.line || 0;
      let column = message.column || 0;

      let arrow = "";
      let hasSource = message.source !== undefined && message.source.length < 1000;
      if (hasSource) {
        for (let i = 0; i < message.column; i++) {
          if (message.source.charAt(i) === "\t") {
            arrow += "\t";
          } else {
            arrow += " ";
          }
        }
        arrow += "^";
      }

      let filePath = message.filePath;
      let link = getFileLink(filePath, line, column);
      let filename = subtleLog(filePath + ":" + line + ":" + column);

      seq.push([
        "",
        messageType + "  " + getKeyLink(message.ruleId || ""),
        message.message.replace(/\.$/, ""),
        "$MARKER$  " + (link === false ? chalk.underline(filename) : filename) +
              (link === false ? "" : "$MARKER$  " + chalk.underline(subtleLog(link))) + "$MARKER$  " +
              (hasSource ? subtleLog(message.source) + "$MARKER$  " + subtleLog(arrow) : "") + "$MARKER$"
      ]);
      return seq;
    }, []), {
      align: [
        "",
        "l",
        "l",
        "l"
      ],
      stringLength: function(str) {
        return stripAnsi(str).length;
      }
    }).replace(/\$MARKER\$/g, "\n");

  total = entries.length;

  if (total > 0) {
    // If showing the 'fixed x files' message along with 'x problems (x errors, x warnings)' message,
    // use yellow so that it's not too subtle. When standing alone, the fixed message can be gray.
    fixedColor = "yellow";
    output += "\n\n";
    output += chalk[summaryColor].bold([
      "✘  ",
      total,
      pluralize(" problem", total),
      " (",
      errors,
      pluralize(" error", errors),
      ", ",
      warnings,
      pluralize(" warning", warnings),
      ")"
    ].join(""));

    if (fixableErrors + fixableWarnings > 0) {
      output += '\n'
        + chalk.yellow.bold([
			  "🔨 ",
			  fixableErrors + fixableWarnings,
			  pluralize(" problem", fixableErrors + fixableWarnings),
			  " (",
			  fixableErrors,
			  pluralize(" error", fixableErrors),
			  ", ",
			  fixableWarnings,
			  pluralize(" warning", fixableWarnings),
			  ")",
			  " fixable with --fix"
      ].join(""));
    }
  }

  if (fixedFiles > 0) {
    output += [
      "\n",
      chalk.yellow("🔨 "),
      chalk[fixedColor](
        "Fixed " +
        fixedFiles +
        pluralize(" file", fixedFiles)
      )
    ].join("") +
    (fromGulp ? "\n" : ""); // Add a line break if running from gulp
  }


  if (errors > 0) {
    output += printSummary(errorsHash, "Errors", "red");
  }

  if (warnings > 0) {
    output += printSummary(warningsHash, "Warnings", "yellow");
  }

  if (total === 0) {
    output += success;
  }

  if (process.env.FORCE_ITERM_HINT === "true" || (process.stdout.isTTY && !process.env.CI)) {
    output = "\u001B]1337;CurrentDir=" + process.cwd() + "\u0007" + output;
  }

  return output;
};
