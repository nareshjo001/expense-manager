"""Generate the verified Level 1 and Level 2 diagrams for ML-API-12.

Run from this directory: python build_ml_api12_forecast.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from workflow_diagram import Diagram, Overview, load_tokens  # noqa: E402


TOKENS = load_tokens()
OUT = os.path.join(HERE, "spending-forecast")


def write_overview():
    overview = Overview(
        TOKENS,
        title="POST /ml/predict-spending-forecast — backend proxy workflow",
        subtitle="Level 1 · actual route and downstream ML-service call",
    )
    diagram = overview.d
    row = overview.ROW1

    diagram.facts_panel(34, overview.BAND_Y, 1520, overview.BAND_H, "Verified facts", [
        ("Route", "POST /ml/predict-spending-forecast", "response"),
        ("Express guard", "Shared /ml API limiter and verifyToken", "auth"),
        ("Downstream", "POST /predict-spending-forecast; default 3000 ms timeout", "insights"),
        ("ML guard", "X-ML-Operations-Token checked before forecasting", "auth"),
        ("Payload", "req.body forwarded as arbitrary JSON", "backend"),
    ])

    caller = overview.card(0, row, "backend", "send", "01", "Inbound Request",
                           "POST /ml/predict-spending-forecast", "req.body is accepted.")
    limiter = overview.card(1, row, "auth", "gauge", "02", "Shared Limiter",
                            "/ml apiLimiter", "Runs before JWT validation.")
    proxy = overview.card(2, row, "backend", "server", "03", "Express Proxy",
                           "requestSpendingForecast(req.body)", "Returns 200, 502, or 500.")
    client = overview.card(3, row, "insights", "send", "04", "ML Client",
                            "axios.post(...), 3000 ms", "Adds operations token if configured.")
    jwt_guard = overview.card(2, overview.ROW2, "auth", "shield", "03", "JWT Validation",
                              "verifyToken", "Sets the authenticated user identity.")
    guard = overview.card(4, row, "auth", "shield", "05", "FastAPI Guard",
                           "_require_operations_token", "Runs before forecast calculation.")
    forecast = overview.card(5, row, "insights", "chart", "06", "Forecast",
                              "predict_spending_snapshot(payload)", "Returns the snapshot result.")
    response = overview.card(6, row, "response", "send", "07", "Response",
                              "200 / 502 / 500", "The proxy translates client failures.")
    overview.chain([caller, limiter, proxy, client, guard, forecast, response], overview.R1_CY)
    diagram.path([(limiter.cx, limiter.bottom), (limiter.cx, jwt_guard.y)], "auth", width=2.2)
    diagram.path([(jwt_guard.right, jwt_guard.cy), (proxy.x, jwt_guard.cy)], "auth", width=2.2)

    svg = overview.render([
        "The Express proxy requires a valid user JWT after the shared /ml limiter.",
        "The ML-service operations-token guard is the downstream authorization boundary and runs before prediction.",
    ], "ML-API-12")
    with open(os.path.join(OUT, "ml-api-12-spending-forecast-overview.svg"), "w", encoding="utf-8") as handle:
        handle.write(svg)


def write_detailed():
    layout, canvas = TOKENS["layout"], TOKENS["canvas"]
    first_y, pitch = layout["firstCardY"], layout["cardPitch"]
    diagram = Diagram(
        TOKENS,
        title="POST /ml/predict-spending-forecast — detailed implementation workflow",
        subtitle="Level 2 · actual middleware, proxy helper, and FastAPI handler",
    )

    incoming = diagram.region(20, 272, "Incoming Request", "Express route input", accent="backend", step=1)
    route = diagram.region(306, 272, "Route Boundary", "Mounted under /ml", accent="auth", step=2)
    proxy = diagram.region(592, 272, "Proxy Helper", "backend/utils/mlServiceClient.js", accent="backend", step=3)
    service = diagram.region(878, 272, "FastAPI Handler", "ml-service/app.py", accent="insights", step=4)
    outcome = diagram.region(1164, 496, "Response Paths", "Success and failures", accent="response", step=5)

    def card(region, index, *args, **kwargs):
        return diagram.card(region.card_x, first_y + index * pitch, *args, **kwargs)

    a1 = card(incoming, 0, "backend", "send", "REQUEST", "Forecast request",
              "req.body", "The proxy accepts and forwards the incoming JSON body.", step="01")
    b1 = card(route, 0, "auth", "gauge", "MIDDLEWARE", "Shared API limiter",
              "router mounted at /ml", "Limiter applies before the handler.", step="02", tag="E1")
    b2 = card(route, 1, "auth", "shield", "AUTH", "JWT validation",
              "verifyToken", "The proxy runs only for an authenticated user.", step="02", tag="E2")
    c1 = card(proxy, 0, "backend", "server", "HANDLER", "Forecast proxy",
              "requestSpendingForecast(req.body)", "Success returns data inside the proxy response.", step="03")
    c2 = card(proxy, 1, "backend", "send", "URL", "Build ML-service URL",
              "buildMlServiceUrl(...)", "Missing or blank ML_ROUTE throws synchronously.", step="04", tag="E3")
    c3 = card(proxy, 2, "insights", "send", "OUTBOUND", "POST with timeout",
              "axios.post(...), 3000 ms", "Configured token is attached as a request header.", step="05")
    d1 = card(service, 0, "auth", "shield", "GUARD", "Operations token",
              "_require_operations_token", "Rejects before calculation when missing, invalid, or unconfigured.", step="06", tag="E4")
    d2 = card(service, 1, "insights", "chart", "FORECAST", "Snapshot prediction",
              "predict_spending_snapshot(payload)", "The arbitrary JSON root payload is passed to the forecaster.", step="07")
    e1 = diagram.card(1180, first_y, "response", "send", "SUCCESS", "200 OK",
                      "{ success: true, data: ... }", "The proxy wraps the returned ML-service data.", step="08")
    e2 = diagram.card(1180, first_y + pitch, "error", "alert", "DOWNSTREAM FAILURE", "502 Bad Gateway",
                      "result.success is false", "Timeout or HTTP failure is returned as a proxy failure.", step="08")
    e3 = diagram.card(1180, first_y + 2 * pitch, "error", "alert", "SYNC FAILURE", "500 Internal Server Error",
                      "handler catch", "For example, ML_ROUTE is missing before axios executes.", step="08")

    diagram.handoff(a1, b1, 299)
    diagram.flow_down(b1, b2)
    diagram.handoff(b2, c1, 585)
    diagram.flow_down(c1, c2)
    diagram.flow_down(c2, c3)
    diagram.handoff(c3, d1, 871)
    diagram.flow_down(d1, d2)
    diagram.handoff(d2, e1, 1157, kind="response", width=TOKENS["stroke"]["responsePath"], label="ML RESULT")
    diagram.flow_down(e1, e2)
    diagram.flow_down(e2, e3)

    diagram.exception_band(20, canvas["bandTop"], 1640, canvas["bandBottom"] - canvas["bandTop"],
                           "Exceptions and Current Limitations")
    width, height, band_y = layout["bandCardWidth"], layout["bandCardHeight"], 982
    x_values = [40, 309, 578, 847]
    x1 = diagram.exception_card(x_values[0], band_y, width, height, "E1", "429 is limiter-controlled",
                                "shared /ml API limiter", "Rate limiting runs before the authenticated handler.")
    x2 = diagram.exception_card(x_values[1], band_y, width, height, "E2", "401 before the proxy",
                                "verifyToken", "A missing or invalid JWT cannot invoke the ML client.")
    x3 = diagram.exception_card(x_values[2], band_y, width, height, "E3", "Invalid ML_ROUTE becomes 500",
                                "buildMlServiceUrl", "The synchronous configuration error reaches the route catch block.")
    x4 = diagram.exception_card(x_values[3], band_y, width, height, "E4", "ML token guard fails closed",
                                "_require_operations_token", "The ML service rejects before invoking the forecasting function.")
    diagram.path([(b1.cx, b1.bottom), (b1.cx, 900), (x1.cx, 900), (x1.cx, x1.y)], "error", dashed=True)
    diagram.path([(b2.cx, b2.bottom), (b2.cx, 908), (x2.cx, 908), (x2.cx, x2.y)], "error", dashed=True)
    diagram.path([(c2.cx, c2.bottom), (c2.cx, 916), (x3.cx, 916), (x3.cx, x3.y)], "error", dashed=True)
    diagram.path([(d1.cx, d1.bottom), (d1.cx, 924), (x4.cx, 924), (x4.cx, x4.y)], "error", dashed=True)

    svg = diagram.render(
        meta_right="BALENISA · Personal Finance Platform",
        meta_left="docs/api-workflows · ML-API-12 · Level 2 detailed",
        footer_notes=[
            "Heavy arrows are region hand-offs; the cyan arrow is the returned ML result. Light arrows are local execution steps.",
            "The route forwards an arbitrary JSON payload; neither the Express proxy nor this FastAPI request model defines forecast fields.",
        ],
    )
    with open(os.path.join(OUT, "ml-api-12-spending-forecast-detailed.svg"), "w", encoding="utf-8") as handle:
        handle.write(svg)


if __name__ == "__main__":
    write_overview()
    write_detailed()
    print("wrote ML-API-12 overview and detailed diagrams")
