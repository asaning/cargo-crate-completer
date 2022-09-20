const vscode = require("vscode");
const fetch = require("node-fetch");

const CARGO_MODE = {
  language: "toml",
  pattern: "**/Cargo.toml",
};

const CRATES_IO_SEARCH_URL = (name) => {
  return `https://crates.io/api/v1/crates?page=1&per_page=10&q=${name}`;
};

const CRATES_IO_CRATE_URL = (crate) => {
  return `https://crates.io/api/v1/crates/${crate}`;
};

const CRATES_IO_CRATE_FEATURES_URL = (crate, version) => {
  return `https://crates.io/api/v1/crates/${crate}/${version}`;
};

function lastDependencies(document, line) {
  let regex = /^\s*\[(.+)\]/gi;
  while (line > 0) {
    let attr = regex.exec(document.lineAt(line).text);
    if (attr) {
      return attr[1];
    }
    line--;
  }
  return "";
}

async function CrateNameProvideCompletionItems(document, position) {
  let line = document.lineAt(position);
  let dependencies = lastDependencies(document, position.line - 1),
    crateName = "";
  if (dependencies === "") {
    return null;
  } else if (dependencies.includes(".")) {
    let index = dependencies.indexOf(".");
    crateName = dependencies.substring(index + 1);
  } else if (dependencies.includes("dependencies")) {
    crateName = line.text.substring(0, position.character);
  }
  if (crateName.includes("=")) {
    return null;
  }

  let res = await fetch(CRATES_IO_SEARCH_URL(crateName));
  res = await res.json();

  const items = res.crates.map((crate) => {
    const item = new vscode.CompletionItem(
      crate.name,
      vscode.CompletionItemKind.Property
    );
    item.insertText = new vscode.SnippetString(
      `${crate.name} = "\${1:${crate.max_stable_version}}"`
    );
    item.detail = `latest: ${crate.max_stable_version}`;
    item.documentation = `${crate.description}`;
    return item;
  });

  return new vscode.CompletionList(items, true);
}

async function CrateVersionProvideCompletionItems(document, position) {
  let line = document.lineAt(position);
  let dependencies = lastDependencies(document, position.line - 1),
    crateName = "";
  if (dependencies === "") {
    return null;
  } else if (dependencies.includes(".")) {
    let index = dependencies.indexOf(".");
    crateName = dependencies.substring(index + 1) + "=";
  }
  let text = line.text.substring(0, position.character);

  if (!crateName) {
    crateName = text;
  }

  const getCrate = /^\s*([\w-]+?)\s*=/;
  const isSimple = /^\s*([\w-]+?)\s*=\s*"$/;
  const isInlineTable = /([\w\s="{]+?)\s*version\s*=\s*"/;
  const isTable = /^version\s*=\s*"/;
  const featuresIsInlineTable = /([\w\s="{]+?),\s*features\s*=\s*\["/;

  if (featuresIsInlineTable.test(text)) {
    return null;
  }

  if (
    !(
      getCrate.test(crateName) &&
      (isSimple.test(text) || isInlineTable.test(text) || isTable.test(text))
    )
  ) {
    return null;
  }

  const crate = getCrate.exec(crateName);

  let res = await fetch(CRATES_IO_CRATE_URL(crate[1]));
  res = await res.json();

  let { crate: crateMeta, versions } = res;

  const items = versions
    .filter((version) => !version.yanked)
    .map((version) => version.num)
    .map((version, i) => {
      const item = new vscode.CompletionItem(
        version,
        vscode.CompletionItemKind.Constant
      );
      item.insertText = new vscode.SnippetString(`${version}`);
      item.sortText = i.toLocaleString("en-US", {
        minimumIntegerDigits: 10,
        useGrouping: false,
      });
      if (version === crateMeta.max_stable_version) {
        item.detail = `latest`;
        item.preselect = true;
      }
      return item;
    });

  return new vscode.CompletionList(items, false);
}

async function CrateFeatureProvideCompletionItems(document, position) {
  let line = document.lineAt(position);
  let dependencies = lastDependencies(document, position.line - 1),
    crateName = "";
  if (dependencies === "") {
    return null;
  } else if (dependencies.includes(".")) {
    let index = dependencies.indexOf(".");
    crateName = dependencies.substring(index + 1) + "=";
  }

  let text = line.text.substring(0, position.character);

  if (!crateName) {
    crateName = text;
  }

  const getCrate = /^\s*([\w-]+?)\s*=/;
  const featuresIsInlineTable = /([\w\s="{]+?),\s*features\s*=\s*\["/;
  const featuresIsTable = /^features\s*=\s*\["/;

  if (
    !(
      getCrate.test(crateName) &&
      (featuresIsInlineTable.test(text) || featuresIsTable.test(text))
    )
  ) {
    return null;
  }

  // 获取version参数
  let version = "";
  if (featuresIsInlineTable.test(text)) {
    let index = text.indexOf("version");
    let start = 0,
      end = 0;
    for (; index < text.length; index++) {
      if (text[index] === "=" && start === 0) {
        start = index;
      }
      if (text[index] === "," && end === 0) {
        end = index;
      }
    }
    version = text.substring(start + 1, end).replace(/[\s"]/g, "");
  }

  if (featuresIsTable.test(text)) {
    let regex = /^\s*\[(.+)\]/gi;
    let line = position.line - 1;
    while (line) {
      let lineText = document.lineAt(line).text;
      if (regex.test(lineText)) {
        break;
      }
      if (lineText.startsWith("version")) {
        let eq = lineText.indexOf("=");
        version = lineText.substring(eq + 1).replace(/[\s"]/g, "");
        break;
      }
      line--;
    }
  }

  let items = [];
  if (version) {
    // 获取features
    const crate = getCrate.exec(crateName);
    let res = await fetch(CRATES_IO_CRATE_FEATURES_URL(crate[1], version));
    res = await res.json();
    let features = res.version.features;
    for (const key in features) {
      if (Object.hasOwnProperty.call(features, key)) {
        const item = new vscode.CompletionItem(
          key,
          vscode.CompletionItemKind.Constant
        );
        item.insertText = new vscode.SnippetString(`${key}`);
        items.push(item);
      }
    }
  }

  return new vscode.CompletionList(items, false);
}

function resolveCompletionItem() {
  return null;
}

function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(CARGO_MODE, {
      provideCompletionItems: CrateNameProvideCompletionItems,
      resolveCompletionItem,
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      CARGO_MODE,
      {
        provideCompletionItems: CrateFeatureProvideCompletionItems,
        resolveCompletionItem,
      },
      ...['"']
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      CARGO_MODE,
      {
        provideCompletionItems: CrateVersionProvideCompletionItems,
        resolveCompletionItem,
      },
      ...['"']
    )
  );
}

module.exports = {
  activate,
};
