import { useEffect, useState } from 'react';
import { Collapse, Spin } from 'antd';

interface Props {
  text: string;
  /** 思考是否正在进行 */
  active: boolean;
}

/** 可折叠的"思考过程"区:思考时自动展开,正文开始输出后自动收起。 */
export default function ThinkingBlock({ text, active }: Props) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);

  return (
    <div className="thinking">
      <Collapse
        ghost
        size="small"
        activeKey={open ? ['think'] : []}
        onChange={(keys) =>
          setOpen(Array.isArray(keys) ? keys.includes('think') : keys === 'think')
        }
        items={[
          {
            key: 'think',
            label: (
              <span className="thinking-label">
                思考过程
                {active && <Spin size="small" style={{ marginLeft: 8 }} />}
              </span>
            ),
            children: <div className="thinking-text">{text}</div>,
          },
        ]}
      />
    </div>
  );
}
