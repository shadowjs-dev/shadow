//! The single authority on "dynamic" expressions and on constant values.

use oxc_ast::ast::{BinaryOperator, Expression, TemplateLiteral, UnaryOperator};
use oxc_ast::ast_kind::AstKind;
use oxc_span::GetSpan;
use oxc_syntax::node::NodeId;

use crate::jsutil::{is_js_whitespace, number_to_string};
use crate::tree::{NodeIx, Tree, Ty};

/// Why a constant could not be computed.
#[derive(Debug, Clone, PartialEq)]
pub enum Constant {
    /// A string value.
    Str(String),
    /// A number value.
    Num(f64),
    /// A boolean value.
    Bool(bool),
    /// `null`.
    Null,
}

/// The result of [`constant_value`].
#[derive(Debug, Clone, PartialEq)]
pub enum ConstantResult {
    /// The expression is not a confident constant.
    NotConstant,
    /// The expression is a constant value.
    Value(Constant),
    /// The value contains something JavaScript strings hold and Rust strings cannot (a lone
    /// surrogate); the caller must not guess.
    Unrepresentable,
}

/// Skips `ParenthesizedExpression` wrappers.
///
/// # Examples
///
/// ```
/// // See the crate tests; the function needs a parsed tree.
/// ```
#[must_use]
pub fn unwrap_parens(tree: &Tree<'_>, mut node: NodeIx) -> NodeIx {
    while tree.ty(node) == Ty::ParenthesizedExpression {
        node += 1;
    }
    node
}

/// The arena index of an expression of the tree.
#[must_use]
pub fn ix_of_expression(expression: &Expression<'_>) -> NodeIx {
    node_ix(expression.node_id())
}

/// The arena index of the expression inside a JSX expression container (not empty).
#[must_use]
pub fn jsx_expression_ix(expression: &oxc_ast::ast::JSXExpression<'_>) -> NodeIx {
    node_ix(expression.node_id())
}

/// The arena index of a JSX attribute value.
#[must_use]
pub fn attribute_value_ix(value: &oxc_ast::ast::JSXAttributeValue<'_>) -> NodeIx {
    node_ix(value.node_id())
}

/// The span of a JSX attribute value.
#[must_use]
pub fn value_span(value: &oxc_ast::ast::JSXAttributeValue<'_>) -> (u32, u32) {
    let span = value.span();
    (span.start, span.end)
}

/// The arena index stored in a `NodeId`.
#[must_use]
pub fn node_ix(id: NodeId) -> NodeIx {
    u32::try_from(oxc_index::Idx::index(id)).unwrap_or(u32::MAX)
}

/// True when the 40 characters before `start` end with `/*@static*/` or `/*@once*/` (with any
/// white space inside and after): the marker that forces an expression static.
fn has_static_marker(source: &str, start: usize) -> bool {
    let head = source.get(..start).unwrap_or("");
    // The window is 40 UTF-16 units before the node, like `source.slice(max(0, start - 40), start)`.
    let mut units = 0;
    let mut window_start = head.len();
    for (index, c) in head.char_indices().rev() {
        units += c.len_utf16();
        if units > 40 {
            break;
        }
        window_start = index;
    }
    let window = head.get(window_start..).unwrap_or("");
    let Some(text) = window.trim_end_matches(is_js_whitespace).strip_suffix("*/") else {
        return false;
    };
    let text = text.trim_end_matches(is_js_whitespace);
    let Some(text) = text
        .strip_suffix("@static")
        .or_else(|| text.strip_suffix("@once"))
    else {
        return false;
    };
    text.trim_end_matches(is_js_whitespace).ends_with("/*")
}

/// Whether an expression must be re-evaluated reactively.
///
/// Dynamic means it contains a call, member access, optional chain, tagged template or `in` test
/// outside nested functions. A bare identifier is static: if it holds a function, the runtime treats
/// it as an accessor. `/*@static*/` (or `/*@once*/`) before an expression forces static.
#[must_use]
pub fn is_dynamic(tree: &Tree<'_>, node: NodeIx, source: &str) -> bool {
    if has_static_marker(source, tree.start(node) as usize) {
        return false;
    }
    let root = unwrap_parens(tree, node);
    if tree.ty(root).is_function() {
        return false;
    }
    let mut dynamic = false;
    tree.walk(root, |current, _| {
        if dynamic {
            return false;
        }
        let ty = tree.ty(current);
        if ty.is_function() {
            return false;
        }
        match ty {
            Ty::CallExpression
            | Ty::MemberExpression
            | Ty::TaggedTemplateExpression
            | Ty::ChainExpression => {
                dynamic = true;
                false
            }
            Ty::BinaryExpression => {
                let is_in = match tree.node(current).kind {
                    AstKind::BinaryExpression(binary) => binary.operator == BinaryOperator::In,
                    AstKind::PrivateInExpression(_) => true,
                    _ => false,
                };
                if is_in {
                    dynamic = true;
                    return false;
                }
                true
            }
            Ty::JSXElement | Ty::JSXFragment => false,
            _ => true,
        }
    });
    dynamic
}

/// True when the subtree creates JSX outside nested functions (JSX inside a function is lazy already).
#[must_use]
pub fn contains_jsx(tree: &Tree<'_>, node: NodeIx) -> bool {
    let mut found = false;
    tree.walk(node, |current, _| {
        if found {
            return false;
        }
        let ty = tree.ty(current);
        if ty.is_function() {
            return false;
        }
        if ty.is_jsx() {
            found = true;
            return false;
        }
        true
    });
    found
}

/// Nesting that [`constant_value`] follows into operators; a deeper chain is left to the runtime.
const FOLD_DEPTH: u32 = 24;

/// A number result only counts when it is finite and not negative zero.
fn plain_number(value: f64) -> Option<f64> {
    if value.is_finite() && !(value == 0.0 && value.is_sign_negative()) {
        Some(value)
    } else {
        None
    }
}

fn template_literal_value(literal: &TemplateLiteral<'_>) -> ConstantResult {
    if !literal.expressions.is_empty() || literal.quasis.len() != 1 {
        return ConstantResult::NotConstant;
    }
    match literal.quasis.first() {
        Some(quasi) => {
            if quasi.lone_surrogates {
                return ConstantResult::Unrepresentable;
            }
            match &quasi.value.cooked {
                Some(cooked) => ConstantResult::Value(Constant::Str(cooked.as_str().to_string())),
                None => ConstantResult::NotConstant,
            }
        }
        None => ConstantResult::NotConstant,
    }
}

fn literal_value(tree: &Tree<'_>, node: NodeIx) -> ConstantResult {
    match tree.node(node).kind {
        AstKind::BooleanLiteral(it) => ConstantResult::Value(Constant::Bool(it.value)),
        AstKind::NullLiteral(_) => ConstantResult::Value(Constant::Null),
        AstKind::NumericLiteral(it) => ConstantResult::Value(Constant::Num(it.value)),
        AstKind::StringLiteral(it) => {
            if it.lone_surrogates {
                ConstantResult::Unrepresentable
            } else {
                ConstantResult::Value(Constant::Str(it.value.as_str().to_string()))
            }
        }
        AstKind::TemplateLiteral(it) => template_literal_value(it),
        _ => ConstantResult::NotConstant,
    }
}

fn evaluate(tree: &Tree<'_>, node: NodeIx, depth: u32) -> ConstantResult {
    let root = unwrap_parens(tree, node);
    match tree.node(root).kind {
        AstKind::UnaryExpression(unary) => {
            if depth >= FOLD_DEPTH {
                return ConstantResult::NotConstant;
            }
            let negate = match unary.operator {
                UnaryOperator::UnaryNegation => true,
                UnaryOperator::UnaryPlus => false,
                _ => return ConstantResult::NotConstant,
            };
            match evaluate(tree, ix_of_expression(&unary.argument), depth + 1) {
                ConstantResult::Value(Constant::Num(value)) => {
                    match plain_number(if negate { -value } else { value }) {
                        Some(number) => ConstantResult::Value(Constant::Num(number)),
                        None => ConstantResult::NotConstant,
                    }
                }
                _ => ConstantResult::NotConstant,
            }
        }
        AstKind::BinaryExpression(binary) => {
            let operator = binary.operator;
            if depth >= FOLD_DEPTH
                || !matches!(
                    operator,
                    BinaryOperator::Addition
                        | BinaryOperator::Subtraction
                        | BinaryOperator::Multiplication
                )
            {
                return ConstantResult::NotConstant;
            }
            let a = evaluate(tree, ix_of_expression(&binary.left), depth + 1);
            let b = evaluate(tree, ix_of_expression(&binary.right), depth + 1);
            // A string that holds a lone surrogate is a string like any other for the rules below.
            let is_text = |c: &ConstantResult| {
                matches!(
                    c,
                    ConstantResult::Unrepresentable
                        | ConstantResult::Value(Constant::Str(_) | Constant::Num(_))
                )
            };
            if a == ConstantResult::Unrepresentable || b == ConstantResult::Unrepresentable {
                return if operator == BinaryOperator::Addition && is_text(&a) && is_text(&b) {
                    ConstantResult::Unrepresentable
                } else {
                    ConstantResult::NotConstant
                };
            }
            let (ConstantResult::Value(a), ConstantResult::Value(b)) = (a, b) else {
                return ConstantResult::NotConstant;
            };
            match (a, b) {
                (Constant::Num(x), Constant::Num(y)) => {
                    let result = match operator {
                        BinaryOperator::Addition => x + y,
                        BinaryOperator::Subtraction => x - y,
                        _ => x * y,
                    };
                    match plain_number(result) {
                        Some(number) => ConstantResult::Value(Constant::Num(number)),
                        None => ConstantResult::NotConstant,
                    }
                }
                (
                    a @ (Constant::Str(_) | Constant::Num(_)),
                    b @ (Constant::Str(_) | Constant::Num(_)),
                ) if operator == BinaryOperator::Addition => {
                    let text = |c: Constant| match c {
                        Constant::Str(s) => s,
                        Constant::Num(n) => number_to_string(n),
                        Constant::Bool(_) | Constant::Null => String::new(),
                    };
                    ConstantResult::Value(Constant::Str(format!("{}{}", text(a), text(b))))
                }
                _ => ConstantResult::NotConstant,
            }
        }
        _ => literal_value(tree, root),
    }
}

/// The literal value of a confidently constant expression: a string, number, boolean or `null`
/// literal, a template literal without holes, a unary `-` or `+` on a number, and `+`, `-` and `*`
/// on those (a result that is not finite, or is negative zero, is not constant). The value is the
/// one the runtime would compute, so folding it is not observable.
#[must_use]
pub fn constant_value(tree: &Tree<'_>, node: NodeIx) -> ConstantResult {
    evaluate(tree, node, 0)
}
