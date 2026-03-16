# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Security Alert Triage System - Main Entry Point"""
import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from src.agents.triage_agent import SecurityAlertTriageAgent
from src.models.alert import SecurityAlert
from src.utils.logger import log
from src.utils.config import config


async def process_single_alert(alert_data: dict):
    """
    处理单个告警

    Args:
        alert_data: 告警数据字典
    """
    log.info("=" * 80)
    log.info("SECURITY ALERT TRIAGE SYSTEM")
    log.info("=" * 80)

    try:
        # 转换为SecurityAlert对象
        alert = SecurityAlert(**alert_data)

        # 打印告警信息
        print("\n" + "=" * 80)
        print("🚨 SECURITY ALERT RECEIVED")
        print("=" * 80)
        print(f"Alert ID:        {alert.alert_id}")
        print(f"Timestamp:       {alert.timestamp}")
        print(f"Type:            {alert.alert_type.value}")
        print(f"Severity:        {alert.severity.value.upper()}")
        print(f"Source IP:       {alert.source_ip}")
        print(f"Target IP:       {alert.target_ip or 'N/A'}")
        print(f"Description:     {alert.description}")
        if alert.file_hash:
            print(f"File Hash:       {alert.file_hash}")
        print("=" * 80)

        # 创建Agent并处理告警
        agent = SecurityAlertTriageAgent()
        result = await agent.process_alert(alert)

        # 打印研判结果
        print("\n" + "=" * 80)
        print("📊 TRIAGE ANALYSIS RESULT")
        print("=" * 80)

        print(f"\n🎯 RISK ASSESSMENT:")
        print(f"   Risk Score:      {result.risk_assessment.risk_score}/100")
        print(f"   Risk Level:      {result.risk_assessment.risk_level.upper()}")
        print(f"   Confidence:      {result.risk_assessment.confidence*100:.1f}%")
        print(f"   Key Factors:")
        for factor in result.risk_assessment.key_factors:
            print(f"      • {factor}")

        print(f"\n🔍 THREAT INTELLIGENCE:")
        if result.threat_intelligence:
            for intel in result.threat_intelligence:
                print(f"   • IOC: {intel.get('ioc', 'N/A')}")
                print(f"     Type: {intel.get('ioc_type', 'N/A')}")
                print(f"     Threat Level: {intel.get('threat_level', 'N/A')}")
                if intel.get('malicious') or intel.get('is_malicious'):
                    print(f"     ⚠️  MALICIOUS")
        else:
            print("   No threat intelligence available")

        print(f"\n🌐 CONTEXT INFORMATION:")
        print(f"   Network:")
        nc = result.context.get('network_context', {})
        print(f"      Source IP Internal: {nc.get('is_internal_source', 'N/A')}")
        print(f"   Asset:")
        ac = result.context.get('asset_context', {})
        print(f"      Type: {ac.get('asset_type', 'N/A')}")
        print(f"      Criticality: {ac.get('criticality', 'N/A')}")

        print(f"\n🛠️  REMEDIATION ACTIONS:")
        for i, action in enumerate(result.remediation, 1):
            automated = "🤖 AUTO" if action.automated else "👤 MANUAL"
            print(f"   {i}. [{action.priority.upper()}] {action.action} ({automated})")
        if action.owner:
            print(f"      Owner: {action.owner}")

        print(f"\n📋 ADDITIONAL INFO:")
        print(f"   Processing Time:  {result.processing_time_seconds:.2f} seconds")
        print(f"   Human Review:     {'⚠️  REQUIRED' if result.requires_human_review else '✓ NOT REQUIRED'}")
        print(f"   Analysis Time:    {result.analysis_timestamp}")

        print("\n" + "=" * 80)
        print("✅ ANALYSIS COMPLETED")
        print("=" * 80 + "\n")

        # 保存结果到JSON文件
        output_dir = Path("logs")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / f"triage_result_{alert.alert_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

        with open(output_file, 'w') as f:
            json.dump(result.model_dump(), f, indent=2, default=str)

        log.info(f"Result saved to: {output_file}")

        return result

    except Exception as e:
        log.error(f"Error processing alert: {str(e)}", exc_info=True)
        print(f"\n❌ Error: {str(e)}\n")
        raise


async def process_batch_alerts(alerts_file: str):
    """
    批量处理告警

    Args:
        alerts_file: 告警JSON文件路径
    """
    log.info(f"Loading alerts from: {alerts_file}")

    with open(alerts_file, 'r') as f:
        data = json.load(f)

    alerts = data.get("alerts", [])
    log.info(f"Found {len(alerts)} alerts to process")

    results = []
    for i, alert_data in enumerate(alerts, 1):
        print(f"\n{'='*80}")
        print(f"Processing alert {i}/{len(alerts)}")
        print(f"{'='*80}\n")

        try:
            result = await process_single_alert(alert_data)
            results.append(result)
        except Exception as e:
            log.error(f"Failed to process alert {alert_data.get('alert_id')}: {str(e)}")
            results.append(None)

    # 汇总统计
    print("\n" + "=" * 80)
    print("📈 BATCH PROCESSING SUMMARY")
    print("=" * 80)
    print(f"Total Alerts:     {len(alerts)}")
    print(f"Successfully:     {sum(1 for r in results if r is not None)}")
    print(f"Failed:           {sum(1 for r in results if r is None)}")

    if results:
        high_risk = sum(1 for r in results if r and r.risk_assessment.risk_level in ['critical', 'high'])
        print(f"High Risk Alerts:  {high_risk}")
        print(f"Human Review:      {sum(1 for r in results if r and r.requires_human_review)}")

    print("=" * 80 + "\n")


async def interactive_mode():
    """交互式模式"""
    print("=" * 80)
    print("🔒 Security Alert Triage System - Interactive Mode")
    print("=" * 80)
    print("\nEnter alert details in JSON format, or 'quit' to exit\n")

    while True:
        try:
            user_input = input(">>> ").strip()

            if user_input.lower() in ['quit', 'exit', 'q']:
                print("\n👋 Goodbye!")
                break

            if not user_input:
                continue

            # 解析JSON输入
            alert_data = json.loads(user_input)
            await process_single_alert(alert_data)

        except json.JSONDecodeError as e:
            print(f"❌ Invalid JSON: {str(e)}")
            print("💡 Tip: Enter alert data in JSON format\n")
        except Exception as e:
            print(f"❌ Error: {str(e)}\n")


def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description="Security Alert Triage System")
    parser.add_argument("--interactive", "-i", action="store_true", help="Interactive mode")
    parser.add_argument("--file", "-f", help="Process alerts from JSON file")
    parser.add_argument("--alert", "-a", help="Process single alert from JSON string")
    parser.add_argument("--sample", "-s", action="store_true", help="Process sample alerts")

    args = parser.parse_args()

    # 运行异步主函数
    if args.interactive:
        asyncio.run(interactive_mode())
    elif args.file:
        asyncio.run(process_batch_alerts(args.file))
    elif args.alert:
        alert_data = json.loads(args.alert)
        asyncio.run(process_single_alert(alert_data))
    elif args.sample:
        sample_file = Path(__file__).parent / "data" / "sample_alerts.json"
        asyncio.run(process_batch_alerts(str(sample_file)))
    else:
        parser.print_help()
        print("\n💡 Quick start:")
        print("   python main.py --sample        # Process sample alerts")
        print("   python main.py --interactive   # Interactive mode")
        print("   python main.py --file alerts.json  # Process from file")


if __name__ == "__main__":
    main()
