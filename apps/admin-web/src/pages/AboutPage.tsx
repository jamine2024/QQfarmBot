import type React from "react";
import { GlassCard } from "../ui/GlassCard";

export function AboutPage(): React.JSX.Element {
  return (
    <div className="grid">
      <div className="gridSpan2">
        <GlassCard title="关于" subtitle="开源信息与免责声明" className="compactCard">
          <div className="aboutStack">
            <div className="aboutBlock">
              <div className="aboutH">版本</div>
              <div className="aboutP mono">V1.9.0</div>
            </div>

            <div className="aboutBlock">
              <div className="aboutH">声明</div>
              <div className="aboutP">程序完全免费，请勿用于商业。</div>
            </div>

            <div className="aboutBlock">
              <div className="aboutH">仓库</div>
              <a className="aboutLink mono" href="https://github.com/jamine2024/QQfarmBot" target="_blank" rel="noreferrer">
                https://github.com/jamine2024/QQfarmBot
              </a>
            </div>

            <div className="aboutBlock">
              <div className="aboutH">作者联系</div>
              <a className="aboutLink mono" href="mailto:frantonytrundle291@gmail.com">
                frantonytrundle291@gmail.com
              </a>
            </div>

            <div className="divider" />

            <div className="aboutBlock">
              <div className="aboutH">免责声明</div>
              <div className="aboutP muted">
                本项目仅供学习和研究用途。使用本脚本可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

